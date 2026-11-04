import type { AiModelInfo } from '../interfaces/ai-result.interface.js';
import type { AiUsage } from '../interfaces/ai-usage.interface.js';

/** The base class of the package's errors. */
export class AiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * A model name, an agent function or an option the package cannot use. Thrown at startup or when the call is made.
 */
export class AiConfigurationError extends AiError {}

/** One failed attempt of a model call. */
export interface AiAttemptFailure {
  model: AiModelInfo;
  attempt: number;
  error: unknown;
}

/** Every attempt of a model call failed, on every model tried. `cause` is the last error. */
export class AiModelError extends AiError {
  constructor(readonly attempts: AiAttemptFailure[]) {
    const last = attempts[attempts.length - 1];
    const tried = [...new Set(attempts.map((attempt) => describeModel(attempt.model)))].join(', ');
    super(`The model call failed after ${attempts.length} attempt(s) (${tried}): ${messageOf(last?.error)}`, {
      cause: last?.error,
    });
  }
}

/** The call would have started a model call over its `budget`. */
export class AiBudgetExceededError extends AiError {
  constructor(
    readonly usage: AiUsage,
    readonly cost: number | undefined,
    readonly limit: { maxTokens?: number; maxCost?: number },
  ) {
    const spent = limit.maxCost !== undefined && cost !== undefined ? `cost ${cost}` : `${usage.totalTokens} tokens`;
    super(`The call's budget is spent (${spent}), so it stopped before the next model call`);
  }
}

/** The model's answer to `generateObject()` is not JSON, or does not match the schema. */
export class AiOutputError extends AiError {
  constructor(
    message: string,
    /** What the model answered. */
    readonly text: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * What the model is told about a tool call that failed: a guard's refusal (`Forbidden resource`), an
 * `HttpException`'s message, `Internal server error` for anything else. `toolName` is the agent function's name.
 */
export class AiToolError extends AiError {
  constructor(
    message: string,
    readonly toolName: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  /** The model reads `String(error)`: the message alone, not the class name. */
  override toString(): string {
    return this.message;
  }
}

export function describeModel(model: AiModelInfo): string {
  return model.name ?? `${model.provider}:${model.modelId}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
