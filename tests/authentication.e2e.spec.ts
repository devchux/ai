/**
 * With `@nestjs/authentication` 0.1.4 and `@nestjs/authorization` 0.1.2, which read `'ai'` calls as they read `'mcp'`
 * ones: from their arguments, `[input, context]`, with the request the call runs in, or the caller's `user`.
 *
 * In a route, the global `AuthenticationGuard` authenticates each agent function call from the route's request (once:
 * the result is cached on the request), `@CurrentUser()` works in agent functions, and `@Can()` decides each call. In
 * a job, there is no request: `@Can()` finds the caller's `user` on the context, and the global guard treats the call
 * as anonymous, as it does over stdio, so the agent functions of jobs are `@Public()`. Refusals are Nest's
 * `UnauthorizedException` and `ForbiddenException`, which the model reads as the tool's error.
 */
import { generateKeyPairSync } from 'node:crypto';
import { Body, Controller, Injectable, Module, Post, Req, type INestApplication } from '@nestjs/common';
import {
  AuthenticationModule,
  AuthenticationRegistry,
  CurrentUser,
  JwtBearerProvider,
  JwtSigner,
  Public,
  type JwtClaims,
} from '@nestjs/authentication';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import { AgentFunction, AiModule, AiService } from '../lib/index.js';
import { FakeModel, overrideModels } from '../lib/testing/index.js';
import { createApp, urlOf } from './support/adapters.js';

const ISSUER = 'https://auth.catstore.example';
const AUDIENCE = 'https://api.catstore.example';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const tokenFor = (sub: string, team: string) =>
  new JwtSigner({ key: privateKey, issuer: ISSUER, audience: AUDIENCE, ttl: '15m' }).sign({ sub, team });

interface Agent {
  id: string;
  team: string;
}

@Injectable()
class AgentAuth extends JwtBearerProvider<Agent> {
  constructor(registry: AuthenticationRegistry) {
    super({ key: publicKey, issuer: ISSUER, audience: AUDIENCE });
    registry.registerProvider(this);
  }

  validate(claims: JwtClaims) {
    return claims.sub ? { id: claims.sub, team: String(claims.team) } : null;
  }
}

@Policy()
class OrderPolicy {
  chat(user: Agent | null) {
    return user !== null;
  }

  view(user: Agent | null) {
    return user !== null;
  }

  refund(user: Agent | null) {
    return user?.team === 'support';
  }
}

/** No `@Public()`: each call is authenticated, from the request the agent runs in. */
@Injectable()
class OrderTools {
  @AgentFunction({ description: 'Who is asking' })
  @Can(OrderPolicy, 'view')
  whoami(_input: unknown, _ctx: unknown, @CurrentUser() agent: Agent) {
    return { id: agent.id, team: agent.team };
  }

  @AgentFunction({ description: 'Refund an order' })
  @Can(OrderPolicy, 'refund')
  refund() {
    return 'refunded';
  }

  @AgentFunction({ description: 'Declares no policy' })
  forgotten() {
    return 'leaked';
  }
}

/** The agent functions of a job: no request to authenticate, so `@Public()`; `@Can()` reads the caller's `user`. */
@Injectable()
@Public()
class JobTools {
  @AgentFunction({ name: 'job-refund', description: 'Refund an order, from a job' })
  @Can(OrderPolicy, 'refund')
  refund() {
    return 'refunded by a job';
  }
}

@Injectable()
class NightlyRefunds {
  constructor(private readonly ai: AiService) {}

  async run(tool: string, user: Agent) {
    const { toolResults } = await this.ai.generateText({ prompt: 'Go', tools: [tool], caller: { user } });
    return toolResults[0];
  }
}

@Controller('assistant')
class AssistantController {
  constructor(private readonly ai: AiService) {}

  @Post()
  @Can(OrderPolicy, 'chat')
  async answer(@Body() body: { tool: string }, @Req() request: unknown) {
    const { toolResults } = await this.ai.generateText({ prompt: 'Go', tools: [body.tool], caller: { request } });
    return toolResults[0];
  }
}

@Module({
  imports: [
    AuthenticationModule.forRoot({}),
    AuthorizationModule.forRoot({ policies: [OrderPolicy] }),
    AiModule.forRoot({ models: { default: new FakeModel([]) } }),
  ],
  controllers: [AssistantController],
  providers: [AgentAuth, OrderTools, JobTools, NightlyRefunds],
})
class AppModule {}

describe('with @nestjs/authentication and @nestjs/authorization', () => {
  let app: INestApplication;
  let url: URL;
  const model = new FakeModel((call) => (call.toolResults.length ? 'done' : { toolCalls: [{ name: call.tools[0]! }] }));

  beforeAll(async () => {
    app = await createApp('express', AppModule, { override: (builder) => overrideModels(builder, { default: model }) });
    url = await urlOf(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const call = async (tool: string, token?: string) => {
    const response = await fetch(new URL('/assistant', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ tool }),
    });
    const text = await response.text();
    return { status: response.status, result: text ? JSON.parse(text) : undefined };
  };

  it('authenticates the route that runs the agent', async () => {
    expect((await call('whoami')).status).toBe(401);
  });

  it("authenticates each agent function call from the route's request: @CurrentUser() works in them", async () => {
    expect((await call('whoami', tokenFor('agent-7', 'support'))).result).toMatchObject({
      output: { id: 'agent-7', team: 'support' },
    });
  });

  it('lets @Can() decide each call, and denies an agent function that declares no policy, as a route', async () => {
    expect((await call('refund', tokenFor('agent-7', 'support'))).result).toMatchObject({ output: 'refunded' });
    expect((await call('refund', tokenFor('agent-9', 'sales'))).result).toMatchObject({ error: 'Forbidden' });
    expect((await call('forgotten', tokenFor('agent-7', 'support'))).result).toMatchObject({ error: 'Forbidden' });
  });

  it("finds a job's user on the context for @Can(), and treats its call as anonymous otherwise", async () => {
    const job = app.get(NightlyRefunds);
    expect(await job.run('job-refund', { id: 'agent-7', team: 'support' })).toMatchObject({ output: 'refunded by a job' });
    expect(await job.run('job-refund', { id: 'agent-9', team: 'sales' })).toMatchObject({ error: 'Forbidden' });
    // Not @Public(): the global guard finds no credentials on a call without a request.
    expect(await job.run('refund', { id: 'agent-7', team: 'support' })).toMatchObject({ error: 'Unauthorized' });
  });
});
