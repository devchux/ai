/** The fake model is SDK-compatible outside AiService as well as through module overrides. */
import { embed, embedMany } from 'ai';
import { FakeEmbeddingModel, fakeEmbeddingModel, providerError } from '../lib/testing/index.js';

describe('FakeEmbeddingModel', () => {
  it('scripts provider calls, accepts more replies, and records options', async () => {
    const model = fakeEmbeddingModel({
      embeddings: [[0.1]],
      usage: { tokens: 3 },
    });
    model.reply({
      embeddings: [[0.2]],
      providerMetadata: { fake: { request: 'r2' } },
    });
    expect(
      (
        await embed({
          model,
          value: 'one',
          providerOptions: { fake: { mode: 'test' } },
        })
      ).usage,
    ).toEqual({ tokens: 3 });
    expect(model.lastCall?.options.providerOptions).toEqual({
      fake: { mode: 'test' },
    });
    expect((await embed({ model, value: 'two' })).embedding).toEqual([0.2]);
    expect(model.calls.map((call) => call.values)).toEqual([['one'], ['two']]);
    expect(model.doEmbedCalls).toEqual(model.calls.map((call) => call.options));
    await expect(embed({ model, value: 'three', maxRetries: 0 })).rejects.toThrow(
      'no answer left for call 3',
    );
  });

  it('answers from input and supports SDK provider batching with default token usage', async () => {
    const model = new FakeEmbeddingModel(
      ({ values }) => ({ embeddings: values.map((value) => [value.length]) }),
      { maxEmbeddingsPerCall: 2 },
    );
    const result = await embedMany({
      model,
      values: ['a', 'bb', 'ccc'],
      maxParallelCalls: 1,
    });
    expect(result.embeddings).toEqual([[1], [2], [3]]);
    expect(result.usage).toEqual({ tokens: 30 });
    expect(model.calls.map((call) => call.values)).toEqual([['a', 'bb'], ['ccc']]);
  });

  it('throws provider errors and cancels delayed responses', async () => {
    const error = providerError(429);
    const model = new FakeEmbeddingModel([error, { embeddings: [[1]], delay: 5_000 }]);
    await expect(embed({ model, value: 'one', maxRetries: 0 })).rejects.toBe(error);
    const controller = new AbortController();
    const promise = embed({
      model,
      value: 'two',
      maxRetries: 0,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(model.calls).toHaveLength(2));
    const reason = new Error('cancelled fake');
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });
});
