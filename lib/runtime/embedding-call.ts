import type { ResiliencePolicy } from '@nestjs/resilience';
import { embed, embedMany, type EmbedManyResult, type EmbedResult } from 'ai';
import { AiConfigurationError } from '../errors/ai.errors.js';
import type {
  AiEmbeddingCallOptions,
  AiEmbeddingSettings,
  AiEmbeddingUsageEvent,
} from '../interfaces/ai-embedding.interface.js';
import type { AiModuleOptions } from '../interfaces/ai-module-options.interface.js';
import type {
  AiEmbeddingModels,
  ResolvedEmbeddingModel,
} from '../models/ai-embedding-models.service.js';
import { modelPolicy, runStep, type PolicyPlan } from './model-policy.js';

const NEVER_ABORTED = new AbortController().signal;
const DEFAULT_MAX_PARALLEL_CALLS = 4;

/** One operation's state. Clients and explicitly supplied resilience policies remain shared. */
export interface EmbeddingPlan extends PolicyPlan<ResolvedEmbeddingModel> {
  model: ResolvedEmbeddingModel;
  label?: string;
  settings: Pick<AiEmbeddingSettings, 'headers' | 'providerOptions'> & { maxParallelCalls: number };
  listeners: Array<(event: AiEmbeddingUsageEvent) => void | Promise<void>>;
}

/**
 * Resolves only embedding settings: language generation defaults never reach an embedding provider.
 */
export function createEmbeddingPlan(
  options: AiEmbeddingCallOptions,
  models: AiEmbeddingModels,
  moduleOptions: AiModuleOptions,
  preset: (name: string) => ResiliencePolicy,
): EmbeddingPlan {
  if (typeof options !== 'object' || options === null) {
    throw new AiConfigurationError(
      'Pass the embedding call its options: { value } or { values }, and the rest.',
    );
  }
  const model = models.resolve(options.model);
  const defaults = moduleOptions.embeddingDefaults ?? {};
  const pick = <K extends keyof AiEmbeddingSettings>(key: K): AiEmbeddingSettings[K] =>
    options[key] ?? model.settings[key] ?? defaults[key];
  const maxParallelCalls = pick('maxParallelCalls') ?? DEFAULT_MAX_PARALLEL_CALLS;
  if (!Number.isSafeInteger(maxParallelCalls) || maxParallelCalls < 1) {
    throw new AiConfigurationError('`maxParallelCalls` must be a finite positive whole number.');
  }
  const own = pick('resilience');
  const policy =
    own === undefined
      ? modelPolicy(model, { retry: pick('retry'), timeout: pick('timeout') }, 'ai:embedding')
      : typeof own === 'string'
        ? preset(own)
        : own;
  return {
    model,
    chain: [model],
    signal: options.abortSignal ?? NEVER_ABORTED,
    source: options.label ?? 'AiService',
    fallbackIf: () => false,
    policyFor: () => policy,
    ...(options.label !== undefined && { label: options.label }),
    settings: {
      maxParallelCalls,
      ...(pick('headers') !== undefined && { headers: pick('headers') }),
      ...(pick('providerOptions') !== undefined && { providerOptions: pick('providerOptions') }),
    },
    listeners: [moduleOptions.onEmbeddingUsage, options.onEmbeddingUsage].filter(
      (listener): listener is (event: AiEmbeddingUsageEvent) => void | Promise<void> =>
        typeof listener === 'function',
    ),
  };
}

interface EmbeddingExecution<R> {
  result: R;
  event: AiEmbeddingUsageEvent;
  attempts: number;
  cost?: number;
}

/**
 * Nest retries the whole SDK operation, not individual chunks. Abort sibling requests as soon as a
 * batch fails, so that a failed attempt does not keep consuming provider capacity while the next
 * attempt starts.
 */
export function runEmbedding(
  plan: EmbeddingPlan,
  input: { value: string },
): Promise<EmbeddingExecution<EmbedResult>>;
export function runEmbedding(
  plan: EmbeddingPlan,
  input: { values: string[] },
): Promise<EmbeddingExecution<EmbedManyResult>>;
export async function runEmbedding(
  plan: EmbeddingPlan,
  input: { value: string } | { values: string[] },
): Promise<EmbeddingExecution<EmbedResult | EmbedManyResult>> {
  const started = performance.now();
  const many = 'values' in input;
  if (
    many
      ? !Array.isArray(input.values) || [...input.values].some((value) => typeof value !== 'string')
      : typeof input.value !== 'string'
  ) {
    throw new AiConfigurationError(
      many ? '`values` must be an array of strings.' : '`value` must be a string.',
    );
  }
  const values = many ? [...input.values] : undefined;
  const { value: result, attempts } = await runStep(plan, async (attempt) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([attempt.signal, controller.signal]);
    try {
      signal.throwIfAborted();
      const settings = {
        model: attempt.model.model,
        headers: plan.settings.headers,
        providerOptions: plan.settings.providerOptions,
        abortSignal: signal,
        maxRetries: 0,
      };
      const result =
        values !== undefined
          ? await embedMany({
              ...settings,
              values,
              maxParallelCalls: plan.settings.maxParallelCalls,
            })
          : await embed({ ...settings, value: (input as { value: string }).value });
      signal.throwIfAborted();
      return result;
    } finally {
      controller.abort();
    }
  });
  const pricing = plan.model.pricing;
  const cost =
    pricing && Number.isFinite(result.usage.tokens)
      ? (result.usage.tokens * pricing.input) / 1_000_000
      : undefined;
  return {
    result,
    attempts,
    ...(cost !== undefined && { cost }),
    event: {
      operation: many ? 'embedMany' : 'embed',
      ...(plan.label !== undefined && { label: plan.label }),
      model: plan.model.info,
      inputCount: values?.length ?? 1,
      usage: { tokens: result.usage.tokens },
      attempts,
      durationMs: Math.round(performance.now() - started),
      ...(cost !== undefined && { cost }),
    },
  };
}
