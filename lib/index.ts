// Module and options
export { AiModule } from './ai.module.js';
export {
  AI_MODULE_OPTIONS,
  type AiModuleAsyncOptions,
  type AiModuleRootOptions,
  type AiOptionsFactory,
} from './ai.module-definition.js';
export { DEFAULT_MODEL_NAME, getModelToken } from './ai.constants.js';
export type {
  AiBudget,
  AiCallDefaults,
  AiCallSettings,
  AiModelDefinition,
  AiModelPricing,
  AiModuleOptions,
  AiModuleStructure,
} from './interfaces/index.js';

// Models and model calls
export { AiModels } from './models/ai-models.service.js';
export { AiService } from './services/ai.service.js';
export {
  AiTextStream,
  type AiStreamResponseOptions,
  type AiUIMessageStreamOptions,
} from './runtime/text-stream.js';
export type {
  AiCallOptions,
  AiModelInfo,
  AiModelReference,
  AiObjectCallOptions,
  AiObjectResult,
  AiSchema,
  AiStep,
  AiTextResult,
  AiToolCall,
  AiToolChoice,
  AiToolResult,
  AiUsage,
  AiUsageEvent,
  InferSchemaOutput,
} from './interfaces/index.js';

// Models by injection (`@InjectModel()`); agent functions (`@AgentFunction()`), which the model is offered as tools:
// what the methods receive, the execution context of their calls, and the registry
export * from './decorators/index.js';
export { AiExecutionContext, type AiContextType } from './context/ai-execution-context.js';
export { AiTools, type AiToolEntry } from './tools/ai-tools.service.js';
export type { AgentFunctionContext, AgentFunctionOptions, AiCaller, AiToolSelection } from './interfaces/index.js';

// Errors
export * from './errors/index.js';
