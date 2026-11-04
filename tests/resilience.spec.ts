/**
 * Model calls on `@nestjs/resilience`: a policy of the application's own (a circuit breaker) and a named preset in
 * place of `retry` and `timeout`, the events the policies publish, and the attempt of a resilient caller.
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { TestingModule } from '@nestjs/testing';
import {
  CircuitBreakerPolicy,
  CircuitOpenError,
  ResilienceContext,
  ResilienceModule,
  ResiliencePolicy,
  RetryPolicy,
  type ResilienceEvent,
} from '@nestjs/resilience';
import { AiConfigurationError, AiModelError } from '../lib/index.js';
import { FakeModel, providerError } from '../lib/testing/index.js';
import { createAi } from './support/module.js';

describe('model calls on @nestjs/resilience', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it("runs a model's calls under a policy of the application's own, and falls back when its breaker opens", async () => {
    const breaker = new CircuitBreakerPolicy({ name: 'llm', minimumCalls: 2, slidingWindow: { type: 'count', size: 2 }, openDuration: '1m' });
    const primary = new FakeModel(() => providerError(500));
    const { moduleRef: ref, ai } = await createAi({
      models: {
        default: { model: primary, resilience: ResiliencePolicy.wrap(breaker, new RetryPolicy(false)) },
        backup: new FakeModel(() => 'from the backup'),
      },
    });
    moduleRef = ref;

    // Two failures open the breaker; each was the only attempt (the policy replaces `retry`).
    await expect(ai.generateText({ prompt: 'a', fallback: false })).rejects.toBeInstanceOf(AiModelError);
    await expect(ai.generateText({ prompt: 'b', fallback: false })).rejects.toBeInstanceOf(AiModelError);
    expect(primary.calls).toHaveLength(2);
    expect(breaker.state).toBe('open');

    // Open: rejected without a model call, as the breaker's own error, and the fallback takes it.
    await expect(ai.generateText({ prompt: 'c', fallback: false })).rejects.toBeInstanceOf(CircuitOpenError);
    expect((await ai.generateText({ prompt: 'd', fallback: 'backup' })).text).toBe('from the backup');
    expect(primary.calls).toHaveLength(2);
  });

  it('takes a preset of ResilienceService by name, and refuses one without ResilienceModule', async () => {
    const model = new FakeModel([providerError(503), 'second attempt']);
    const { moduleRef: ref, ai } = await createAi(
      { models: { default: { model, resilience: 'llm' } } },
      { imports: [ResilienceModule.forRoot({ presets: { llm: { retry: { attempts: 2, backoff: { delay: 0 } }, timeout: '5s' } } })] },
    );
    moduleRef = ref;
    expect((await ai.generateText({ prompt: 'Hi' })).text).toBe('second attempt');
    expect(model.calls).toHaveLength(2);

    const { moduleRef: without, ai: alone } = await createAi({ models: { default: { model: new FakeModel([]), resilience: 'llm' } } });
    await expect(alone.generateText({ prompt: 'Hi' })).rejects.toThrow(AiConfigurationError);
    await without.close();
  });

  it("publishes the policies' events, named after the model and labeled with the call", async () => {
    const events: ResilienceEvent[] = [];
    const listener = (event: unknown) => void events.push(event as ResilienceEvent);
    subscribe('nestjs:resilience:retry', listener);
    subscribe('nestjs:resilience:fallback', listener);
    try {
      const { moduleRef: ref, ai } = await createAi({
        models: { default: { model: new FakeModel(() => providerError(429)), fallback: 'backup' }, backup: new FakeModel(() => 'ok') },
        defaults: { retry: { attempts: 2, backoff: { delay: 0 } } },
      });
      moduleRef = ref;
      await ai.generateText({ prompt: 'Hi', label: 'triage' });
    } finally {
      unsubscribe('nestjs:resilience:retry', listener);
      unsubscribe('nestjs:resilience:fallback', listener);
    }
    expect(events).toEqual([
      expect.objectContaining({ type: 'retry', policy: 'ai:default retry', source: 'triage', attempt: 1 }),
      expect.objectContaining({ type: 'fallback', policy: 'ai:default fallback', source: 'triage' }),
    ]);
  });

  it('stops when the resilient attempt it runs in is aborted', async () => {
    const model = new FakeModel(() => ({ text: 'slow', delay: 5_000 }));
    const { moduleRef: ref, ai } = await createAi({ models: { default: model } });
    moduleRef = ref;

    const controller = new AbortController();
    const call = new ResilienceContext().run({ signal: controller.signal }, () => ai.generateText({ prompt: 'Hi' }));
    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    controller.abort(new Error('the route timed out'));
    await expect(call).rejects.toThrow('the route timed out');
    expect(model.calls).toHaveLength(1);
  });
});
