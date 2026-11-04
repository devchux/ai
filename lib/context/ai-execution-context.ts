import type { ArgumentsHost, ExecutionContext, Type } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import type { AgentFunctionContext } from '../interfaces/agent-function.interface.js';

/** `context.getType<AiContextType>() === 'ai'` in an enhancer tells an agent function call from an HTTP request. */
export type AiContextType = 'ai';

/**
 * The execution context of an agent function call, for guards, interceptors and exception filters, as
 * `McpExecutionContext` is for MCP calls:
 *
 * ```ts
 * canActivate(context: ExecutionContext) {
 *   if (context.getType<AiContextType>() !== 'ai') {
 *     return true;
 *   }
 *   const call = AiExecutionContext.create(context);
 *   return call.getRequest()?.user?.role === 'support';
 * }
 * ```
 *
 * The arguments of an agent function call are `[input, context]`: `getInput()` (also `switchToRpc().getData()`) and
 * `getContext()`.
 */
export class AiExecutionContext extends ExecutionContextHost {
  static create(context: ExecutionContext | ArgumentsHost): AiExecutionContext {
    const host = context as Partial<ExecutionContext> & ArgumentsHost;
    const ai = new AiExecutionContext(
      context.getArgs(),
      host.getClass?.() as Type<unknown> | undefined,
      host.getHandler?.() as Function | undefined,
    );
    ai.setType(context.getType());
    return ai;
  }

  /** The arguments, validated against the function's `inputSchema`. */
  getInput<T = any>(): T {
    return this.getArgByIndex(0);
  }

  getContext<TRequest = any, TUser = any>(): AgentFunctionContext<TRequest, TUser> {
    return this.getArgByIndex(1);
  }

  /** The agent function's name. */
  getName(): string | undefined {
    return this.getContext()?.name;
  }

  /** The HTTP platform's request the agent runs in (`caller.request`); `undefined` where there is none, as in a job. */
  getRequest<TRequest = any>(): TRequest | undefined {
    return this.getContext<TRequest>()?.request;
  }
}
