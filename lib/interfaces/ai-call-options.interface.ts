import type { LanguageModel, ModelMessage } from 'ai';
import type { AiBudget, AiCallSettings } from './ai-module-options.interface.js';
import type { AiSchema } from './ai-schema.interface.js';
import type { AiCaller, AiToolSelection } from './ai-tool.interface.js';
import type { AiUsageEvent } from './ai-usage.interface.js';

export type AiToolChoice = 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string };

/** A model: its name in `forRoot({ models })`, or a `LanguageModel`. */
export type AiModelReference = string | Exclude<LanguageModel, string>;

/** The options of `generateText()` and `streamText()`. */
export interface AiCallOptions extends AiCallSettings {
  /** Default `'default'`. */
  model?: AiModelReference;
  /** The system prompt. */
  instructions?: string;
  /** The user's message; or `messages`, a whole conversation. */
  prompt?: string;
  messages?: ModelMessage[];
  /**
   * The agent functions (`@AgentFunction()` methods) the model may call, by name or by provider class (all its agent
   * functions). The model is offered each as a tool, and only those listed here.
   */
  tools?: AiToolSelection;
  /** Who the call acts for: what agent functions and their guards see. */
  caller?: AiCaller;
  toolChoice?: AiToolChoice;
  /** Model calls this call may make while the model asks for tools. Default 10. */
  maxSteps?: number;
  /**
   * Models tried in order when the model fails after its retries; `false` for none. Default: the model's own
   * `fallback`.
   */
  fallback?: AiModelReference | ReadonlyArray<AiModelReference> | false;
  /**
   * Which failures move on to the next model (the `FallbackPolicy`'s `handleIf`). Default: any but the caller's
   * abort, an answer that does not match the schema, and mistakes in the call.
   */
  fallbackIf?: (error: unknown) => boolean;
  budget?: AiBudget;
  /**
   * Cancels the call: the model call in flight, the backoff, the agent functions running (through their context's
   * `signal`).
   */
  abortSignal?: AbortSignal;
  /** Names the call in usage events (`'triage'`). */
  label?: string;
  /** Called after every model call of this call that answered, after the module's `onUsage`. */
  onUsage?: (event: AiUsageEvent) => void | Promise<void>;
  topP?: number;
  topK?: number;
  seed?: number;
  stopSequences?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
}

/** The options of `generateObject()`. */
export interface AiObjectCallOptions<S extends AiSchema = AiSchema> extends AiCallOptions {
  /** What the answer must be. The model is sent its JSON Schema, and its answer is validated by it. */
  schema: S;
  /** A name and a description of the object, which some providers pass on to the model. */
  schemaName?: string;
  schemaDescription?: string;
}
