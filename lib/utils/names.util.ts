import { AiConfigurationError } from '../errors/ai.errors.js';

/** What OpenAI, Anthropic and Google accept as a tool name, which is what an agent function's name is to the model. */
const PROVIDER_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Throws for an agent function name model providers refuse, naming the method. */
export function assertProviderToolName(name: string, where: string): void {
  if (typeof name !== 'string' || !PROVIDER_TOOL_NAME.test(name)) {
    throw new AiConfigurationError(
      `${where}: the name ${JSON.stringify(name)} is not one model providers accept as a tool name: 1 to 64 ` +
        'characters out of A-Z a-z 0-9 _ -. Give @AgentFunction() a { name } that fits.',
    );
  }
}
