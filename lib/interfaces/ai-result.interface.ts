import type { FinishReason, ModelMessage } from 'ai';
import type { AiUsage } from './ai-usage.interface.js';

/** Which model answered. */
export interface AiModelInfo {
  /**
   * Its name in `models` or `embeddingModels`; `undefined` for an SDK model object passed directly
   * to the call.
   */
  name?: string;
  provider: string;
  modelId: string;
}

export interface AiToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface AiToolResult extends AiToolCall {
  /** What the tool returned; absent when it failed. */
  output?: unknown;
  /** What the model was told about a failure. */
  error?: string;
}

/** One model call of a text generation, with the tool calls it made and their results. */
export interface AiStep {
  index: number;
  model: AiModelInfo;
  text: string;
  toolCalls: AiToolCall[];
  toolResults: AiToolResult[];
  finishReason: FinishReason;
  usage: AiUsage;
  cost?: number;
  /** Attempts made for this step, over every model tried. */
  attempts: number;
}

export interface AiTextResult {
  /** The text of the last step. */
  text: string;
  /** The last step's: `tool-calls` when `maxSteps` ran out while the model still asked for tools. */
  finishReason: FinishReason;
  steps: AiStep[];
  /** Summed over the steps. */
  usage: AiUsage;
  /** Summed over the steps whose model has `pricing`; `undefined` when none had. */
  cost?: number;
  toolCalls: AiToolCall[];
  toolResults: AiToolResult[];
  /** The assistant and tool messages of every step, to append to a conversation. */
  responseMessages: ModelMessage[];
  /** The model of the last step. */
  model: AiModelInfo;
}

export interface AiObjectResult<T> extends AiTextResult {
  /** The answer, validated by the schema. */
  object: T;
}
