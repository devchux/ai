import { AGENT_FUNCTION_METADATA } from '../ai.constants.js';
import type { AgentFunctionOptions } from '../interfaces/agent-function.interface.js';

/**
 * Makes the method an agent function: one the application's agents may call, which a call lists in `tools`, and the
 * model is offered as a tool. It is called as `(input, context)`: `input` is the arguments, validated against
 * `inputSchema`, and `context` the `AgentFunctionContext`. Guards, interceptors, pipes and exception filters run
 * around it, with the context type `'ai'` (`AiExecutionContext` reads the call).
 *
 * ```ts
 * @AgentFunction({
 *   name: 'find-order',
 *   description: 'Find an order by its id',
 *   inputSchema: z.object({ orderId: z.string() }),
 * })
 * find({ orderId }: { orderId: string }, ctx: AgentFunctionContext) {
 *   return this.orders.find(orderId);
 * }
 * ```
 *
 * A method that MCP clients call too also carries `@nestjs/mcp`'s `@Tool()`, with options of its own: neither
 * decorator reads the other's.
 */
export function AgentFunction(options: AgentFunctionOptions = {}): MethodDecorator {
  const metadata: AgentFunctionOptions = { ...options };
  return (target, key, descriptor) => {
    const method = descriptor.value;
    const where = `${typeof target === 'function' ? target.name : target.constructor.name}.${String(key)}`;
    if (typeof method !== 'function') {
      throw new TypeError(`@AgentFunction() goes on a method, and ${where} is not one.`);
    }
    if (Reflect.hasOwnMetadata(AGENT_FUNCTION_METADATA, method)) {
      throw new TypeError(`${where} has @AgentFunction() twice: give it one, with all its options.`);
    }
    Reflect.defineMetadata(AGENT_FUNCTION_METADATA, metadata, method);
    return descriptor;
  };
}
