import { Inject } from '@nestjs/common';
import { DEFAULT_MODEL_NAME, getModelToken } from '../ai.constants.js';
import { recordModelRequest } from '../models/model-requests.js';

/**
 * Injects the configured `LanguageModel` called `name` (default `'default'`), for code that calls `ai` itself.
 * `AiService` calls get retries, timeouts, fallback and usage events; a direct `ai` call gets none of them. A name
 * the module does not configure fails at startup.
 *
 * ```ts
 * constructor(@InjectModel('fast') private readonly model: LanguageModel) {}
 * ```
 */
export function InjectModel(name: string = DEFAULT_MODEL_NAME): PropertyDecorator & ParameterDecorator {
  recordModelRequest(name);
  return Inject(getModelToken(name));
}
