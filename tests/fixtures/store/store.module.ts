import {
  Body,
  Catch,
  Controller,
  createParamDecorator,
  ForbiddenException,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Req,
  Res,
  SetMetadata,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  type ArgumentMetadata,
  type ArgumentsHost,
  type CallHandler,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
  type PipeTransform,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { McpExecutionContext, McpModule, Tool, type McpContext, type McpContextType } from '@nestjs/mcp';
import { convertToModelMessages, type UIMessage } from 'ai';
import { tap, type Observable } from 'rxjs';
import * as z from 'zod';
import {
  AgentFunction,
  AiExecutionContext,
  AiModule,
  AiService,
  type AgentFunctionContext,
  type AiContextType,
} from '../../../lib/index.js';
import { FakeModel } from '../../../lib/testing/index.js';

export interface User {
  name: string;
  role: 'customer' | 'support';
}

const USERS: Record<string, User> = {
  alice: { name: 'alice', role: 'customer' },
  sam: { name: 'sam', role: 'support' },
};

type CallType = AiContextType | McpContextType | 'http';

/**
 * The user of a call: an agent function's caller's (its `user`, else its request's), an MCP client's request's, or a
 * route's. Each kind of call has its own context type, read with its own execution context.
 */
export function userOf(context: ExecutionContext | ArgumentsHost): User | undefined {
  switch (context.getType<CallType>()) {
    case 'ai': {
      const call = AiExecutionContext.create(context).getContext<{ user?: User }, User>();
      return call.user ?? call.request?.user;
    }
    case 'mcp':
      return McpExecutionContext.create(context).getRequest<{ user?: User }>()?.user;
    default:
      return context.switchToHttp().getRequest<{ user?: User }>().user;
  }
}

/** The name of the agent function or MCP tool called. */
function nameOf(context: ExecutionContext | ArgumentsHost): string | undefined {
  return context.getType<CallType>() === 'ai'
    ? AiExecutionContext.create(context).getName()
    : McpExecutionContext.create(context).getName();
}

/** What the enhancers saw, in order. */
@Injectable()
export class CallLog {
  readonly entries: string[] = [];
  clear() {
    this.entries.length = 0;
  }
}

@Injectable()
export class OrdersService {
  private readonly orders = new Map([
    ['ord_1', { id: 'ord_1', owner: 'alice', status: 'shipped', address: '1 Cat Street, Catford' }],
    ['ord_2', { id: 'ord_2', owner: 'bob', status: 'packing', address: '2 Dog Lane, Barking' }],
  ]);

  find(id: string) {
    return this.orders.get(id);
  }

  changeAddress(id: string, address: string) {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`There is no order ${id}`);
    }
    order.address = address;
    return order;
  }
}

/** Every call, globally (APP_GUARD): the route's, each agent function call's, and each MCP call's. */
@Injectable()
export class GlobalGuard implements CanActivate {
  constructor(private readonly log: CallLog) {}

  canActivate(context: ExecutionContext): boolean {
    const type = context.getType<CallType>();
    this.log.entries.push(type === 'http' ? 'global guard http' : `global guard ${type} ${nameOf(context)}`);
    return true;
  }
}

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

/** Lets a call through when the caller's user has one of the method's roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly log: CallLog,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[] | undefined>('roles', context.getHandler());
    const user = userOf(context);
    this.log.entries.push(`roles guard ${nameOf(context)} as ${user?.name ?? 'nobody'}`);
    return !roles || roles.includes(user?.role ?? '');
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly log: CallLog) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const name = AiExecutionContext.create(context).getName();
    this.log.entries.push(`interceptor before ${name}`);
    return next.handle().pipe(tap(() => this.log.entries.push(`interceptor after ${name}`)));
  }
}

/** Trims the strings of the input, which it sees as the call's body. */
@Injectable()
export class TrimPipe implements PipeTransform {
  constructor(private readonly log: CallLog) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    this.log.entries.push(`pipe ${metadata.type}`);
    if (metadata.type !== 'body' || typeof value !== 'object' || value === null) {
      return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : item]));
  }
}

export class PaymentsDownError extends Error {}

/** Answers a PaymentsDownError with an output of its own. */
@Catch(PaymentsDownError)
export class PaymentsFilter implements ExceptionFilter {
  catch(_exception: PaymentsDownError, host: ArgumentsHost) {
    return { error: `Payments are down; ${AiExecutionContext.create(host).getName()} can be retried in a few minutes.` };
  }
}

/** A custom parameter decorator, as `@CurrentUser()` is one: the caller's user. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => userOf(context));

/** The context type a custom parameter decorator sees. */
export const SeenType = createParamDecorator((_data: unknown, context: ExecutionContext) => context.getType());

/**
 * A guard of a method that serves both consumers, which tells them apart by the context type: through the agent, a
 * customer finds their own orders only; the support team's MCP clients find every order. Any other call is refused.
 */
@Injectable()
export class OwnOrdersGuard implements CanActivate {
  constructor(private readonly orders: OrdersService) {}

  canActivate(context: ExecutionContext): boolean {
    switch (context.getType<CallType>()) {
      case 'mcp':
        return true;
      case 'ai': {
        const order = this.orders.find(AiExecutionContext.create(context).getInput<{ orderId: string }>().orderId);
        return order === undefined || order.owner === userOf(context)?.name;
      }
      default:
        return false;
    }
  }
}

/** The arguments of find-order: one schema for both of its decorators. */
export const FindOrderInput = z.object({ orderId: z.string().describe('The order id, such as ord_1') });

@Injectable()
@UseGuards(RolesGuard)
export class OrdersTools {
  constructor(
    private readonly orders: OrdersService,
    private readonly log: CallLog,
  ) {}

  // One method, two decorators, each with its own options: an MCP tool for MCP clients, and an agent function of the
  // application's own agent.
  @Tool({ name: 'find-order', description: 'Find an order by its id', inputSchema: FindOrderInput })
  @AgentFunction({ name: 'find-order', description: 'Find an order by its id', inputSchema: FindOrderInput })
  @UseGuards(OwnOrdersGuard)
  find(
    { orderId }: { orderId: string },
    _ctx: McpContext | AgentFunctionContext,
    @CurrentUser() user: User | undefined,
    @SeenType() type: string,
  ) {
    this.log.entries.push(`find-order ${orderId} for ${user?.name ?? 'nobody'} (${type})`);
    const order = this.orders.find(orderId);
    if (!order) {
      throw new NotFoundException(`There is no order ${orderId}`);
    }
    return { id: order.id, status: order.status };
  }
}

/** Agent functions only: no `@Tool()`, and their module is not one `McpModule` includes. */
@Injectable()
@UseGuards(RolesGuard)
export class AgentTools {
  constructor(
    private readonly orders: OrdersService,
    private readonly log: CallLog,
  ) {}

  @AgentFunction({
    name: 'change-address',
    description: 'Change the delivery address of an order',
    inputSchema: z.object({ orderId: z.string(), address: z.string().min(10) }),
  })
  @Roles('support')
  @UseInterceptors(AuditInterceptor)
  @UsePipes(TrimPipe)
  changeAddress({ orderId, address }: { orderId: string; address: string }) {
    this.log.entries.push(`change-address "${address}"`);
    return this.orders.changeAddress(orderId, address);
  }

  @AgentFunction({ description: 'Refund an order', inputSchema: z.object({ orderId: z.string() }), scopes: ['orders:refund'] })
  refund({ orderId }: { orderId: string }) {
    return { refunded: orderId };
  }

  @AgentFunction({ description: 'Charge a card' })
  @UseFilters(PaymentsFilter)
  charge() {
    throw new PaymentsDownError('the payment provider timed out');
  }

  @AgentFunction({ description: 'Reads the database' })
  explode() {
    throw new Error('connection to postgres://admin:hunter2@db failed');
  }

  @AgentFunction({ description: 'Who is asking' })
  whoami(_input: unknown, ctx: AgentFunctionContext, @CurrentUser() user: User | undefined) {
    return { user: user?.name ?? null, toolCallId: ctx.toolCallId, sawRequest: ctx.request !== undefined };
  }

  @AgentFunction({ description: 'Forbidden in the method' })
  forbidden() {
    throw new ForbiddenException('Not your order');
  }

  @AgentFunction({ name: 'pack-order', description: 'Packs an order, which takes a while' })
  async pack() {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { packed: true };
  }
}

interface AssistantBody {
  message: string;
  tools?: string[];
}

/** What `useChat()` posts (through `DefaultChatTransport`), with the call's own fields. */
interface ChatBody {
  messages: UIMessage[];
  tools?: string[];
  keepAlive?: number | false;
}

/** Sets `request.user` from the `x-user` header, as an authentication guard does. */
@Injectable()
export class AuthenticateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: User }>();
    const name = request.headers['x-user'];
    if (name && USERS[name]) {
      request.user = USERS[name];
    }
    return true;
  }
}

@Controller('assistant')
@UseGuards(AuthenticateGuard)
export class AssistantController {
  constructor(private readonly ai: AiService) {}

  @Post()
  async answer(@Body() body: AssistantBody, @Req() request: unknown, @Headers('x-scopes') scopes?: string) {
    const result = await this.ai.generateText({
      instructions: 'You help customers of the cat store with their orders.',
      prompt: body.message,
      tools: body.tools ?? ['find-order'],
      caller: { request, ...(scopes && { scopes: scopes.split(' ') }) },
    });
    return { text: result.text, toolResults: result.toolResults, steps: result.steps.length };
  }

  @Post('stream')
  async stream(@Body() body: AssistantBody, @Req() request: unknown, @Res() response: unknown) {
    const answer = this.ai.streamText({ prompt: body.message, tools: body.tools ?? ['find-order'], caller: { request } });
    await answer.pipeUIMessageStreamToResponse(response, { headers: { 'x-assistant': 'cat-store' } });
  }

  @Post('chat')
  async chat(@Body() body: ChatBody, @Req() request: unknown, @Res() response: unknown) {
    const answer = this.ai.streamText({
      messages: await convertToModelMessages(body.messages),
      tools: body.tools ?? ['find-order'],
      caller: { request },
    });
    await answer.pipeUIMessageStreamToResponse(response, { ...(body.keepAlive !== undefined && { keepAlive: body.keepAlive }) });
  }

  @Post('text')
  async text(@Body() body: AssistantBody, @Res() response: unknown) {
    await this.ai.streamText({ prompt: body.message }).pipeTextStreamToResponse(response);
  }
}

/** What the agent functions and tools of both modules share. */
@Module({ providers: [CallLog, OrdersService], exports: [CallLog, OrdersService] })
export class StoreCoreModule {}

@Module({ imports: [StoreCoreModule], providers: [OrdersTools] })
export class OrdersToolsModule {}

@Module({ imports: [StoreCoreModule], providers: [AgentTools] })
export class AgentToolsModule {}

@Module({
  imports: [
    AiModule.forRoot({ models: { default: new FakeModel([]) }, defaults: { retry: { attempts: 2, backoff: { delay: 0 } } } }),
    // MCP clients get the @Tool() methods of OrdersToolsModule; the agent gets the @AgentFunction() methods of both.
    McpModule.forRoot({ name: 'cat-store', version: '1.0.0', include: [OrdersToolsModule] }),
    StoreCoreModule,
    OrdersToolsModule,
    AgentToolsModule,
  ],
  controllers: [AssistantController],
  providers: [{ provide: APP_GUARD, useClass: GlobalGuard }],
})
export class StoreModule {}
