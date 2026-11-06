import type { EmbeddingModel, EmbeddingModelUsage, EmbedManyResult, EmbedResult } from 'ai';
import type { AiResilienceSettings } from './ai-module-options.interface.js';
import type { AiModelInfo } from './ai-result.interface.js';

/** Embedding settings, independent of language-model generation defaults. */
export interface AiEmbeddingSettings extends AiResilienceSettings {
  /** Provider-specific options, by provider name. */
  providerOptions?: Record<string, Record<string, any>>;
  /** HTTP headers sent to the embedding provider. */
  headers?: Record<string, string>;
  /** Maximum concurrent SDK batch requests within one `embedMany()` operation. Default 4. */
  maxParallelCalls?: number;
}

/** Price per million input tokens, in the unit used for reported `cost`. */
export interface AiEmbeddingModelPricing {
  input: number;
}

/** A registered SDK embedding model with its own embedding settings. */
export interface AiEmbeddingModelDefinition extends AiEmbeddingSettings {
  model: EmbeddingModel;
  pricing?: AiEmbeddingModelPricing;
}

/** A registered embedding name, or an SDK embedding-model object passed directly to a call. */
export type AiEmbeddingModelReference = string | Exclude<EmbeddingModel, string>;

/** Options shared by single and batch embedding calls. */
export interface AiEmbeddingCallOptions extends AiEmbeddingSettings {
  /** Name in `embeddingModels` (default `'default'`), or a direct SDK model object. */
  model?: AiEmbeddingModelReference;
  /** Cancels in-flight provider requests and retry backoff. */
  abortSignal?: AbortSignal;
  /** Names this operation in usage and resilience events. */
  label?: string;
  /** Called after a successful operation, after the module's embedding usage listener. */
  onEmbeddingUsage?: (event: AiEmbeddingUsageEvent) => void | Promise<void>;
}

export interface AiEmbedOptions extends AiEmbeddingCallOptions {
  value: string;
}

export interface AiEmbedManyOptions extends AiEmbeddingCallOptions {
  values: string[];
}

/** SDK single-embedding result with the resolved model and operation-level attempt count. */
export interface AiEmbedResult extends EmbedResult {
  model: AiModelInfo;
  attempts: number;
  /** Cost of the successful attempt's reported usage; absent without model pricing. */
  cost?: number;
}

/**
 * SDK batch result, in input order. A failed operation rejects rather than returning partial
 * results.
 */
export interface AiEmbedManyResult extends EmbedManyResult {
  model: AiModelInfo;
  attempts: number;
  /** Cost of the successful attempt's reported usage; absent without model pricing. */
  cost?: number;
}

/**
 * One successful embedding operation. Retries may repeat successful batches, so this is not a
 * billing ledger. Input contents and output vectors are excluded.
 */
export interface AiEmbeddingUsageEvent {
  operation: 'embed' | 'embedMany';
  label?: string;
  model: AiModelInfo;
  inputCount: number;
  usage: EmbeddingModelUsage;
  /** Number of whole-operation attempts, including the successful one. */
  attempts: number;
  /** Total duration of the operation, including retries and backoff. */
  durationMs: number;
  cost?: number;
}
