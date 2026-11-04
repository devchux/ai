import type { ModelMessage } from 'ai';
import type { AiSchema } from './ai-schema.interface.js';

/** The options of `@AgentFunction()`. */
export interface AgentFunctionOptions {
  /**
   * The name calls list it by in `tools`, and the model calls it by: 1 to 64 characters out of `A-Z a-z 0-9 _ -`, which
   * is what model providers accept as a tool name. Default: the method's name.
   */
  name?: string;
  /** What it does: the model picks the functions it calls by their names and descriptions. */
  description?: string;
  /**
   * Its arguments: an object schema, whose JSON Schema the model is sent, and which validates every call before the
   * method runs. Default: no arguments.
   */
  inputSchema?: AiSchema;
  /** The scopes the caller must hold (`caller.scopes`): a call without them is refused before any guard runs. */
  scopes?: readonly string[];
}

/**
 * The second argument of an agent function, and `AiExecutionContext.getContext()` in its guards, interceptors and
 * exception filters: who the call acts for (the call's `caller`), and the model's tool call.
 */
export interface AgentFunctionContext<TRequest = any, TUser = any> {
  /** The agent function's name. */
  readonly name: string;
  /**
   * The HTTP platform's request the agent runs in (`caller.request`): Express's, Fastify's or the Node adapter's, with
   * its headers and the `user` your authentication set on it. `undefined` where there is none, as in a queue job.
   */
  readonly request?: TRequest;
  /** Who the call acts for where there is no request (`caller.user`), as in a queue job or a durable run. */
  readonly user?: TUser;
  /** The scopes the caller holds (`caller.scopes`), which the function's own `scopes` require. */
  readonly scopes?: readonly string[];
  /** Aborted when the call is: pass it on to `fetch()` and your database. */
  readonly signal: AbortSignal;
  /**
   * In a streamed answer, sends the browser the call's progress, as a transient `data-tool-progress` chunk; elsewhere,
   * does nothing.
   */
  reportProgress(progress: number, total?: number, message?: string): Promise<void>;
  /** The model's id for this tool call, to tie the function's logs to the agent's conversation. */
  readonly toolCallId: string;
  /**
   * In a durable run (`@nestjs/ai/workflows`): the same for every attempt of this call, including the one a process
   * that died mid-call makes again. Pass it on to what the function changes (a payment provider's idempotency key), so
   * the change happens once. `undefined` outside durable runs.
   */
  readonly idempotencyKey?: string;
  /** The messages the model had read when it called the function, without the system prompt. */
  readonly messages: readonly ModelMessage[];
}
