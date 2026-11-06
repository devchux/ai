import { Inject } from '@nestjs/common';
import { DEFAULT_MODEL_NAME, getEmbeddingModelToken } from '../ai.constants.js';
import { recordEmbeddingModelRequest } from '../models/model-requests.js';

/**
 * Injects the configured `EmbeddingModel` called `name` (default `'default'`), for code that calls
 * `ai` directly. Direct SDK calls do not get `AiService`'s resilience or usage events. An unknown
 * name fails at startup.
 *
 * ```ts
 * constructor(@InjectEmbeddingModel('documents') private readonly model: EmbeddingModel) {}
 * ```
 */
export function InjectEmbeddingModel(
  name: string = DEFAULT_MODEL_NAME,
): PropertyDecorator & ParameterDecorator {
  recordEmbeddingModelRequest(name);
  return Inject(getEmbeddingModelToken(name));
}
