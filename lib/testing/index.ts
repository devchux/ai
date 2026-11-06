/**
 * `@nestjs/ai/testing`: a fake model, and helpers for tests of applications that use `AiModule`.
 *
 * ```ts
 * const model = new FakeModel(['Your order ships tomorrow.']);
 * const moduleRef = await overrideModels(
 *   Test.createTestingModule({ imports: [AppModule] }),
 *   { default: model },
 * ).compile();
 * ```
 */
import type { INestApplicationContext } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { AI_EMBEDDING_MODEL_OVERRIDES, AI_MODEL_OVERRIDES } from '../ai.constants.js';
import type { AiCaller } from '../interfaces/ai-tool.interface.js';
import { AiTools } from '../tools/ai-tools.service.js';

export {
  FakeModel,
  fakeModel,
  providerError,
  type FakeAnswer,
  type FakeModelCall,
  type FakeToolCall,
  type FakeTurn,
} from './fake-model.js';
export {
  FakeEmbeddingModel,
  fakeEmbeddingModel,
  type FakeEmbeddingAnswer,
  type FakeEmbeddingModelCall,
  type FakeEmbeddingModelOptions,
  type FakeEmbeddingTurn,
} from './fake-embedding-model.js';

/**
 * Replaces configured models by name (`{ default: new FakeModel([...]) }`) in a testing module,
 * keeping their other options (pricing, fallback, timeouts). A name that is not configured fails at
 * compile time.
 */
export function overrideModels(
  builder: TestingModuleBuilder,
  models: Record<string, LanguageModel>,
): TestingModuleBuilder {
  return builder.overrideProvider(AI_MODEL_OVERRIDES).useValue(models);
}

/**
 * Replaces configured embedding models by name, preserving their settings and pricing. Unknown
 * names fail at startup.
 */
export function overrideEmbeddingModels(
  builder: TestingModuleBuilder,
  models: Record<string, EmbeddingModel>,
): TestingModuleBuilder {
  return builder.overrideProvider(AI_EMBEDDING_MODEL_OVERRIDES).useValue(models);
}

/**
 * Calls the agent function `name` with `input` as `caller`, as an agent's call does: the input
 * validated by its schema, its scopes checked, then its guards, interceptors, pipes and filters,
 * then the method. Resolves with what the model would read; rejects with the `AiToolError` it would
 * read (a guard's `Forbidden resource`).
 */
export async function callTool(
  app: INestApplicationContext,
  name: string,
  input: unknown = {},
  { caller }: { caller?: AiCaller } = {},
): Promise<unknown> {
  await app.init();
  return app.get(AiTools, { strict: false }).call(name, input, caller);
}
