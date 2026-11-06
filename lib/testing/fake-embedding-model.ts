import { MockEmbeddingModelV4 } from 'ai/test';

type CallOptions = Parameters<MockEmbeddingModelV4['doEmbed']>[0];
type EmbedResult = Awaited<ReturnType<MockEmbeddingModelV4['doEmbed']>>;

/**
 * One provider response of a fake embedding model, including one vector for each value in that
 * call.
 */
export interface FakeEmbeddingTurn {
  embeddings: number[][];
  /** Default: 10 tokens per value. */
  usage?: { tokens: number };
  /** Milliseconds before the answer; cancellation cuts the wait short. */
  delay?: number;
  warnings?: EmbedResult['warnings'];
  providerMetadata?: EmbedResult['providerMetadata'];
  response?: EmbedResult['response'];
}

/** A provider call the fake received. SDK batching can make several calls for one embedMany(). */
export interface FakeEmbeddingModelCall {
  values: string[];
  options: CallOptions;
}

/** An embedding response, provider error, or function of the provider call. */
export type FakeEmbeddingAnswer =
  | FakeEmbeddingTurn
  | Error
  | ((call: FakeEmbeddingModelCall) => FakeEmbeddingAnswer | Promise<FakeEmbeddingAnswer>);

/** Provider capabilities used by the SDK when it batches input values. */
export interface FakeEmbeddingModelOptions {
  provider?: string;
  modelId?: string;
  /** Omitted: no provider batch limit. */
  maxEmbeddingsPerCall?: number;
  /** Default true. */
  supportsParallelCalls?: boolean;
}

/**
 * An embedding model for offline tests. Answers provider calls in order, records them, and supports
 * the SDK's batching. A function answers every call; reply() appends scripted responses. No vectors
 * are generated implicitly.
 *
 * ```ts
 * const model = new FakeEmbeddingModel([{ embeddings: [[0.1, 0.2]], usage: { tokens: 3 } }]);
 * ```
 */
export class FakeEmbeddingModel extends MockEmbeddingModelV4 {
  readonly calls: FakeEmbeddingModelCall[] = [];
  private readonly answers: FakeEmbeddingAnswer[];
  private readonly answerAll:
    | ((call: FakeEmbeddingModelCall) => FakeEmbeddingAnswer | Promise<FakeEmbeddingAnswer>)
    | undefined;

  constructor(
    answers:
      | FakeEmbeddingAnswer[]
      | ((call: FakeEmbeddingModelCall) => FakeEmbeddingAnswer | Promise<FakeEmbeddingAnswer>) = [],
    {
      provider = 'fake',
      modelId = 'fake-embedding-model',
      maxEmbeddingsPerCall,
      supportsParallelCalls = true,
    }: FakeEmbeddingModelOptions = {},
  ) {
    super({
      provider,
      modelId,
      maxEmbeddingsPerCall: maxEmbeddingsPerCall ?? null,
      supportsParallelCalls,
    });
    this.answers = Array.isArray(answers) ? [...answers] : [];
    this.answerAll = typeof answers === 'function' ? answers : undefined;
    this.doEmbed = async (options) => {
      this.doEmbedCalls.push(options);
      const call = { values: [...options.values], options };
      this.calls.push(call);
      options.abortSignal?.throwIfAborted();
      let answer: FakeEmbeddingAnswer | undefined = this.answerAll ?? this.answers.shift();
      if (answer === undefined) {
        throw new Error(
          `FakeEmbeddingModel: no answer left for call ${this.calls.length}. Give it more answers.`,
        );
      }
      while (typeof answer === 'function') {
        answer = await answer(call);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      if (answer.delay) {
        await sleep(answer.delay, options.abortSignal);
      }
      options.abortSignal?.throwIfAborted();
      return {
        embeddings: answer.embeddings,
        usage: answer.usage ?? { tokens: call.values.length * 10 },
        warnings: answer.warnings ?? [],
        ...(answer.providerMetadata !== undefined && {
          providerMetadata: answer.providerMetadata,
        }),
        ...(answer.response !== undefined && { response: answer.response }),
      };
    };
  }

  /** Adds responses after the unused scripted responses. */
  reply(...answers: FakeEmbeddingAnswer[]): this {
    this.answers.push(...answers);
    return this;
  }

  /** The last provider call, or undefined. */
  get lastCall(): FakeEmbeddingModelCall | undefined {
    return this.calls[this.calls.length - 1];
  }
}

/** new FakeEmbeddingModel(answers). */
export function fakeEmbeddingModel(...answers: FakeEmbeddingAnswer[]): FakeEmbeddingModel {
  return new FakeEmbeddingModel(answers);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
