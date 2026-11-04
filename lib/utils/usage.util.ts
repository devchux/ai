import type { LanguageModelUsage } from 'ai';
import type { AiModelPricing } from '../interfaces/ai-module-options.interface.js';
import type { AiUsage } from '../interfaces/ai-usage.interface.js';

export const ZERO_USAGE: AiUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});

/** `ai`'s usage of one model call, with what the provider did not report as 0. */
export function toUsage(usage: LanguageModelUsage | undefined): AiUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** The cost of `usage` at `pricing` (per million tokens); `undefined` without pricing. */
export function costOf(usage: AiUsage, pricing: AiModelPricing | undefined): number | undefined {
  if (!pricing) {
    return undefined;
  }
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cost =
    (usage.inputTokens - cached) * pricing.input +
    cached * (pricing.cachedInput ?? pricing.input) +
    usage.outputTokens * pricing.output;
  return cost / 1_000_000;
}

export function addCost(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}
