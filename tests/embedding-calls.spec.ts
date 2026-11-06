/**
 * Embedding operations keep SDK batching/results and add Nest policies, bounded concurrency and
 * separate usage events.
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import {
  BulkheadPolicy,
  ResilienceContext,
  ResilienceModule,
  ResilienceTimeoutError,
  type ResilienceEvent,
} from '@nestjs/resilience';
import { AiConfigurationError, AiModelError, type AiEmbeddingUsageEvent } from '../lib/index.js';
import { FakeEmbeddingModel, providerError } from '../lib/testing/index.js';
import { createAi } from './support/module.js';

const noWait = { attempts: 3, backoff: { delay: 0, jitter: 'none' as const } };

describe('embedding calls', () => {
  let moduleRef: TestingModule | undefined;
  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the single SDK result and model identity', async () => {
    vi.stubGlobal('AI_SDK_LOG_WARNINGS', false);
    const model = new FakeEmbeddingModel([
      {
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 3 },
        warnings: [{ type: 'other', message: 'provider notice' }],
        providerMetadata: { fake: { request: 'r1' } },
        response: { headers: { 'x-request-id': 'r1' }, body: { ok: true } },
      },
    ]);
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
    });
    moduleRef = ref;
    const result = await ai.embed({ value: 'hello' });
    expect(result).toMatchObject({
      value: 'hello',
      embedding: [0.1, 0.2],
      usage: { tokens: 3 },
      warnings: [{ type: 'other', message: 'provider notice' }],
      providerMetadata: { fake: { request: 'r1' } },
      response: { headers: { 'x-request-id': 'r1' }, body: { ok: true } },
      model: {
        name: 'default',
        provider: 'fake',
        modelId: 'fake-embedding-model',
      },
      attempts: 1,
    });
    expect(result.cost).toBeUndefined();
    expect(model.lastCall?.values).toEqual(['hello']);
  });

  it('accepts direct model objects and forwards embedding provider options', async () => {
    const configured = new FakeEmbeddingModel([]);
    const direct = new FakeEmbeddingModel([{ embeddings: [[1]] }], {
      provider: 'other',
      modelId: 'direct',
    });
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: configured },
      defaults: {
        providerOptions: { language: { secret: 'text-only' } },
        headers: { 'x-language': 'text-only' },
        temperature: 0.9,
      },
      embeddingDefaults: {
        providerOptions: { other: { dimensions: 1 } },
        headers: { 'x-embedding': 'vectors' },
      },
    });
    moduleRef = ref;
    expect((await ai.embed({ model: direct, value: 'hello' })).model).toEqual({
      provider: 'other',
      modelId: 'direct',
    });
    expect(direct.lastCall?.options.providerOptions).toEqual({
      other: { dimensions: 1 },
    });
    expect(direct.lastCall?.options.headers).toMatchObject({
      'x-embedding': 'vectors',
    });
    expect(direct.lastCall?.options.headers).not.toHaveProperty('x-language');
    expect(direct.lastCall?.options).not.toHaveProperty('temperature');
    expect(configured.calls).toEqual([]);
  });

  it('takes call settings over model settings over embedding defaults', async () => {
    const model = new FakeEmbeddingModel((call) => ({
      embeddings: call.values.map(() => [1]),
    }));
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: {
        default: {
          model,
          providerOptions: { fake: { source: 'model' } },
          headers: { 'x-source': 'model' },
        },
      },
      embeddingDefaults: {
        providerOptions: { fake: { source: 'defaults' } },
        headers: { 'x-source': 'defaults' },
      },
    });
    moduleRef = ref;
    await ai.embed({ value: 'a' });
    expect(model.lastCall?.options.providerOptions).toEqual({
      fake: { source: 'model' },
    });
    expect(model.lastCall?.options.headers).toMatchObject({
      'x-source': 'model',
    });
    await ai.embed({
      value: 'b',
      providerOptions: { fake: { source: 'call' } },
      headers: { 'x-source': 'call' },
    });
    expect(model.lastCall?.options.providerOptions).toEqual({
      fake: { source: 'call' },
    });
    expect(model.lastCall?.options.headers).toMatchObject({
      'x-source': 'call',
    });
  });

  it.each([
    {
      defaults: undefined,
      own: undefined,
      call: undefined,
      expected: 4,
      parallel: true,
    },
    {
      defaults: 3,
      own: undefined,
      call: undefined,
      expected: 3,
      parallel: true,
    },
    { defaults: 3, own: 2, call: undefined, expected: 2, parallel: true },
    { defaults: 3, own: 2, call: 1, expected: 1, parallel: true },
    {
      defaults: undefined,
      own: undefined,
      call: undefined,
      expected: 1,
      parallel: false,
    },
  ])(
    'bounds SDK batches with concurrency $expected (parallel support $parallel)',
    async ({ defaults, own, call, expected, parallel }) => {
      const release: Array<() => void> = [];
      let active = 0;
      let peak = 0;
      const model = new FakeEmbeddingModel(
        async ({ values }) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => release.push(resolve));
          active--;
          return {
            embeddings: values.map((value) => [Number(value), Number(value) + 0.5]),
            usage: { tokens: values.length },
          };
        },
        { maxEmbeddingsPerCall: 1, supportsParallelCalls: parallel },
      );
      const { moduleRef: ref, ai } = await createAi({
        embeddingModels: { default: { model, maxParallelCalls: own } },
        embeddingDefaults: { maxParallelCalls: defaults },
      });
      moduleRef = ref;
      const values = ['0', '1', '2', '3', '4', '5'];
      const promise = ai.embedMany({ values, maxParallelCalls: call });
      await vi.waitFor(() => expect(model.calls).toHaveLength(expected));
      expect(active).toBe(expected);
      // Complete each wave in reverse order to exercise stable output ordering as well as admission
      // bounds.
      while (model.calls.length < values.length) {
        const started = model.calls.length;
        release
          .splice(0)
          .reverse()
          .forEach((resolve) => resolve());
        await vi.waitFor(() => expect(model.calls.length).toBeGreaterThan(started));
      }
      release
        .splice(0)
        .reverse()
        .forEach((resolve) => resolve());
      const result = await promise;
      expect(result.values).toEqual(values);
      expect(result.embeddings).toEqual(
        values.map((value) => [Number(value), Number(value) + 0.5]),
      );
      expect(result.usage).toEqual({ tokens: 6 });
      expect(result.attempts).toBe(1);
      expect(peak).toBe(expected);
      expect(model.calls.map((entry) => entry.values)).toEqual(values.map((value) => [value]));
    },
  );

  it('retries whole SDK batch operations, including earlier successful batches', async () => {
    const model = new FakeEmbeddingModel(
      [
        { embeddings: [[1]], usage: { tokens: 2 } },
        providerError(503),
        { embeddings: [[3]], usage: { tokens: 2 } },
        { embeddings: [[4]], usage: { tokens: 3 } },
      ],
      { maxEmbeddingsPerCall: 1, supportsParallelCalls: false },
    );
    const events: AiEmbeddingUsageEvent[] = [];
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
      embeddingDefaults: { retry: { ...noWait, attempts: 2 } },
      onEmbeddingUsage: (event) => void events.push(event),
    });
    moduleRef = ref;
    const result = await ai.embedMany({ values: ['a', 'b'] });
    expect(result.embeddings).toEqual([[3], [4]]);
    expect(result.usage).toEqual({ tokens: 5 });
    expect(result.attempts).toBe(2);
    expect(model.calls.map((call) => call.values)).toEqual([['a'], ['b'], ['a'], ['b']]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'embedMany',
      inputCount: 2,
      attempts: 2,
      usage: { tokens: 5 },
    });
  });

  it('keeps retry counts under Nest control and does not retry client errors', async () => {
    const model = new FakeEmbeddingModel(() => providerError(503));
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
      embeddingDefaults: { retry: noWait },
    });
    moduleRef = ref;
    const error = (await ai
      .embed({ value: 'hello' })
      .catch((error: unknown) => error)) as AiModelError;
    expect(error).toBeInstanceOf(AiModelError);
    expect(error.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    expect(model.calls).toHaveLength(3);
    const client = new FakeEmbeddingModel([providerError(400), { embeddings: [[1]] }]);
    await expect(ai.embed({ model: client, value: 'bad' })).rejects.toThrow(AiModelError);
    expect(client.calls).toHaveLength(1);
    const disabled = new FakeEmbeddingModel([providerError(503), { embeddings: [[1]] }]);
    await expect(ai.embed({ model: disabled, value: 'bad', retry: false })).rejects.toThrow(
      AiModelError,
    );
    expect(disabled.calls).toHaveLength(1);
  });

  it('aborts sibling provider requests when a parallel batch fails', async () => {
    const model = new FakeEmbeddingModel(
      ({ values }) =>
        values[0] === 'fail' ? providerError(503) : { embeddings: [[1]], delay: 5_000 },
      { maxEmbeddingsPerCall: 1 },
    );
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
    });
    moduleRef = ref;
    await expect(ai.embedMany({ values: ['fail', 'slow'], retry: false })).rejects.toThrow(
      AiModelError,
    );
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].options.abortSignal?.aborted).toBe(true);
  });

  it('shares custom bulkheads across operations while preserving SDK batch limits', async () => {
    const policy = new BulkheadPolicy({
      name: 'embedding-capacity',
      maxConcurrent: 1,
      maxQueue: 1,
    });
    const release: Array<() => void> = [];
    const model = new FakeEmbeddingModel(
      async ({ values }) => {
        await new Promise<void>((resolve) => release.push(resolve));
        return { embeddings: values.map((value) => [Number(value)]) };
      },
      { maxEmbeddingsPerCall: 1 },
    );
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: {
        default: { model, resilience: policy, maxParallelCalls: 2 },
      },
    });
    moduleRef = ref;
    const first = ai.embedMany({ values: ['1', '2'] });
    await vi.waitFor(() => expect(model.calls).toHaveLength(2));
    const second = ai.embedMany({ values: ['3', '4'] });
    await vi.waitFor(() => expect(policy.queued).toBe(1));
    expect(policy.active).toBe(1);
    expect(model.calls).toHaveLength(2);
    release.splice(0).forEach((resolve) => resolve());
    expect((await first).embeddings).toEqual([[1], [2]]);
    await vi.waitFor(() => expect(model.calls).toHaveLength(4));
    release.splice(0).forEach((resolve) => resolve());
    expect((await second).embeddings).toEqual([[3], [4]]);
    expect(policy.active).toBe(0);
    expect(policy.queued).toBe(0);
  });

  it('times out whole-operation attempts and aborts their provider calls', async () => {
    const model = new FakeEmbeddingModel(() => ({
      embeddings: [[1]],
      delay: 5_000,
    }));
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
      embeddingDefaults: { timeout: '10ms', retry: { ...noWait, attempts: 2 } },
    });
    moduleRef = ref;
    const error = (await ai
      .embed({ value: 'slow' })
      .catch((error: unknown) => error)) as AiModelError;
    expect(error).toBeInstanceOf(AiModelError);
    expect(error.attempts).toHaveLength(2);
    expect(error.cause).toBeInstanceOf(ResilienceTimeoutError);
    expect(model.calls).toHaveLength(2);
    expect(model.calls.every((call) => call.options.abortSignal?.aborted)).toBe(true);
  });

  it('propagates caller and ambient cancellation to active batches', async () => {
    const model = new FakeEmbeddingModel(
      ({ values }) => ({ embeddings: values.map(() => [1]), delay: 5_000 }),
      { maxEmbeddingsPerCall: 1 },
    );
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
    });
    moduleRef = ref;
    for (const ambient of [false, true]) {
      const controller = new AbortController();
      const before = model.calls.length;
      const promise = ambient
        ? new ResilienceContext().run({ signal: controller.signal }, () =>
            ai.embedMany({ values: ['a', 'b'] }),
          )
        : ai.embedMany({ values: ['a', 'b'], abortSignal: controller.signal });
      await vi.waitFor(() => expect(model.calls).toHaveLength(before + 2));
      const reason = new Error('stop embeddings');
      controller.abort(reason);
      await expect(promise).rejects.toBe(reason);
      expect(model.calls.slice(before).every((call) => call.options.abortSignal?.aborted)).toBe(
        true,
      );
    }
  });

  it('cancels retry backoff without beginning another request', async () => {
    const model = new FakeEmbeddingModel([providerError(503), { embeddings: [[1]] }]);
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
    });
    moduleRef = ref;
    const controller = new AbortController();
    const promise = ai.embed({
      value: 'a',
      abortSignal: controller.signal,
      retry: { attempts: 2, backoff: { delay: 5_000, jitter: 'none' } },
    });
    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    controller.abort(new Error('backoff cancelled'));
    await expect(promise).rejects.toThrow('backoff cancelled');
    expect(model.calls).toHaveLength(1);
  });

  it('uses named resilience presets and emits their retry events', async () => {
    const model = new FakeEmbeddingModel([providerError(429), { embeddings: [[2]] }]);
    const events: ResilienceEvent[] = [];
    const listener = (event: unknown) => void events.push(event as ResilienceEvent);
    const { moduleRef: ref, ai } = await createAi(
      {
        embeddingModels: { default: { model, resilience: 'embedding-policy' } },
      },
      {
        imports: [
          ResilienceModule.forRoot({
            presets: {
              'embedding-policy': {
                retry: { attempts: 2, backoff: { delay: 0 } },
                timeout: '1s',
              },
            },
          }),
        ],
      },
    );
    moduleRef = ref;
    subscribe('nestjs:resilience:retry', listener);
    try {
      expect((await ai.embed({ value: 'hello', label: 'index' })).embedding).toEqual([2]);
    } finally {
      unsubscribe('nestjs:resilience:retry', listener);
    }
    expect(events).toEqual([
      expect.objectContaining({ type: 'retry', source: 'index', attempt: 1 }),
    ]);
    expect(model.calls).toHaveLength(2);
  });

  it('reports separate aggregate usage and cost without input or vector payloads', async () => {
    const moduleEvents: AiEmbeddingUsageEvent[] = [];
    const callEvents: AiEmbeddingUsageEvent[] = [];
    const languageUsage = vi.fn();
    const model = new FakeEmbeddingModel([{ embeddings: [[1], [2]], usage: { tokens: 7 } }]);
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: { model, pricing: { input: 1_000_000 } } },
      onUsage: languageUsage,
      onEmbeddingUsage: (event) => void moduleEvents.push(event),
    });
    moduleRef = ref;
    const result = await ai.embedMany({
      values: ['private document', 'another private document'],
      label: 'index',
      onEmbeddingUsage: (event) => void callEvents.push(event),
    });
    expect(result.cost).toBe(7);
    expect(moduleEvents).toHaveLength(1);
    expect(callEvents).toEqual(moduleEvents);
    expect(moduleEvents[0]).toEqual({
      operation: 'embedMany',
      label: 'index',
      model: result.model,
      inputCount: 2,
      usage: { tokens: 7 },
      attempts: 1,
      durationMs: expect.any(Number),
      cost: 7,
    });
    expect(languageUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(moduleEvents)).not.toContain('private');
    expect(moduleEvents[0]).not.toHaveProperty('embeddings');
  });

  it('contains listener failures and still invokes the other listener', async () => {
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: {
        default: new FakeEmbeddingModel([{ embeddings: [[1]] }, { embeddings: [[2]] }]),
      },
      onEmbeddingUsage: () => {
        throw new Error('sync observer');
      },
    });
    moduleRef = ref;
    expect((await ai.embed({ value: 'a', onEmbeddingUsage: listener })).embedding).toEqual([1]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      (
        await ai.embed({
          value: 'b',
          onEmbeddingUsage: async () => {
            throw new Error('async observer');
          },
        })
      ).embedding,
    ).toEqual([2]);
    await vi.waitFor(() => expect(logger.mock.calls.flat().join(' ')).toContain('async observer'));
    expect(logger.mock.calls.flat().join(' ')).toContain('sync observer');
  });

  it('rejects invalid inputs and concurrency before calling a provider', async () => {
    const model = new FakeEmbeddingModel([]);
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
    });
    moduleRef = ref;
    for (const maxParallelCalls of [0, -1, 1.5, Infinity, NaN]) {
      await expect(ai.embedMany({ values: ['a'], maxParallelCalls })).rejects.toThrow(
        AiConfigurationError,
      );
    }
    await expect(ai.embed({ value: 1 as unknown as string })).rejects.toThrow(AiConfigurationError);
    await expect(ai.embedMany({ values: [1] as unknown as string[] })).rejects.toThrow(
      AiConfigurationError,
    );
    expect(model.calls).toEqual([]);
  });

  it('rejects already-aborted calls without provider requests or success events', async () => {
    const model = new FakeEmbeddingModel([]);
    const onEmbeddingUsage = vi.fn();
    const { moduleRef: ref, ai } = await createAi({
      embeddingModels: { default: model },
      onEmbeddingUsage,
    });
    moduleRef = ref;
    const controller = new AbortController();
    const reason = new Error('already stopped');
    controller.abort(reason);
    await expect(ai.embed({ value: 'a', abortSignal: controller.signal })).rejects.toBe(reason);
    expect(model.calls).toEqual([]);
    expect(onEmbeddingUsage).not.toHaveBeenCalled();
  });
});
