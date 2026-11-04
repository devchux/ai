import { Workflow, type WorkflowContext, type WorkflowRunner } from '@nestjs/workflows';
import { AGENT_WORKFLOW, AiAgents, type AgentSettings, type AgentState } from './ai-agents.service.js';
import type { AiAgentRunResult } from './ai-agent.interfaces.js';

/** A run of `AiAgents.run()` going on in a child instance, from where its parent stopped. Internal. */
@Workflow(AGENT_WORKFLOW)
export class AiAgentSegment implements WorkflowRunner<{ settings: AgentSettings; state: AgentState }, AiAgentRunResult> {
  constructor(private readonly agents: AiAgents) {}

  run(ctx: WorkflowContext, { settings, state }: { settings: AgentSettings; state: AgentState }): Promise<AiAgentRunResult> {
    return this.agents.resume(ctx, settings, state);
  }
}
