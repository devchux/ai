/**
 * `@nestjs/ai/workflows`: the agent loop as a durable workflow, on `@nestjs/workflows`.
 */
export { AiWorkflowsModule } from './ai-workflows.module.js';
export { AiAgents, TOOL_APPROVAL } from './ai-agents.service.js';
export type {
  AiAgentCaller,
  AiAgentRunOptions,
  AiAgentRunResult,
  AiPendingApproval,
  AiToolApproval,
} from './ai-agent.interfaces.js';
