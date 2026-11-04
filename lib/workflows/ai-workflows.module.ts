import { Module } from '@nestjs/common';
import { AiAgentSegment } from './ai-agent.workflow.js';
import { AiAgents } from './ai-agents.service.js';

/**
 * Durable agent runs on `@nestjs/workflows`: import it next to `AiModule` and `WorkflowsModule`, and inject
 * `AiAgents` into your `@Workflow()` classes.
 */
@Module({
  providers: [AiAgents, AiAgentSegment],
  exports: [AiAgents],
})
export class AiWorkflowsModule {}
