/** The module options (`forRoot()`'s, or what the `forRootAsync()` factory returns). */
export const AI_MODULE_OPTIONS = 'AI_MODULE_OPTIONS';

/** Where `@AgentFunction()` records its options, on the method. */
export const AGENT_FUNCTION_METADATA = 'nestjs:ai:agent-function';

/**
 * The `ExecutionContext` type of agent function calls: `context.getType() === 'ai'` in a guard, an interceptor or an
 * exception filter, which reads the call with `AiExecutionContext`.
 */
export const AI_CONTEXT_TYPE = 'ai';

/**
 * The parameter metadata of agent functions, read by `ExternalContextCreator` (so that pipes run on the input): Nest's
 * own route-arguments key, where `createParamDecorator()` decorators record themselves. `@nestjs/mcp` records the two
 * parameters of its methods under the same key, with the same numbers (`AiParamtype`), so a method that is both an
 * agent function and an MCP tool is recorded once, and both read it.
 */
export const AI_PARAMS_METADATA = '__routeArguments__';

/** The name of the model calls use when they name none. */
export const DEFAULT_MODEL_NAME = 'default';

/** Models that replace configured ones by name, from `@nestjs/ai/testing`'s `overrideModels()`. Internal. */
export const AI_MODEL_OVERRIDES = Symbol('AI_MODEL_OVERRIDES');

/** The injection token of the model called `name`, which `@InjectModel(name)` injects. */
export function getModelToken(name: string = DEFAULT_MODEL_NAME): string {
  return `nestjs:ai:model:${name}`;
}
