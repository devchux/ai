import { AiConfigurationError } from '../errors/ai.errors.js';
import type { AiModuleOptions } from '../interfaces/ai-module-options.interface.js';

/**
 * Checks registry structure without contacting a provider. Either kind may be omitted, but not
 * both.
 */
export function assertModelRegistries(options: AiModuleOptions): void {
  let count = 0;
  for (const key of ['models', 'embeddingModels'] as const) {
    const entries = options?.[key];
    if (entries === undefined) {
      continue;
    }
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
      throw new AiConfigurationError(`AiModule: \`${key}\` must be a record of named models.`);
    }
    count += Object.keys(entries).length;
  }
  if (count === 0) {
    throw new AiConfigurationError(
      'AiModule: configure at least one model in `models` or `embeddingModels`.',
    );
  }
}
