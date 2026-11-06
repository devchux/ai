import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AI_EMBEDDING_MODEL_OVERRIDES, AI_MODEL_OVERRIDES } from './ai.constants.js';
import {
  ConfigurableModuleClass,
  type AiModuleAsyncOptions,
  type AiModuleRootOptions,
  type OPTIONS_TYPE,
} from './ai.module-definition.js';
import { AiModels } from './models/ai-models.service.js';
import { AiEmbeddingModels } from './models/ai-embedding-models.service.js';
import { AiService } from './services/ai.service.js';
import { AiTools } from './tools/ai-tools.service.js';

/**
 * `AiModule.forRoot({ models: { default: ... } })`, or `forRootAsync({ imports, inject, useFactory })`: the
 * application's models by name, `AiService` for model calls, and the `@AgentFunction()` methods of its providers,
 * which its agents call as tools. Global with `isGlobal: true`.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    AiModels,
    AiEmbeddingModels,
    AiTools,
    AiService,
    { provide: AI_MODEL_OVERRIDES, useValue: null },
    { provide: AI_EMBEDDING_MODEL_OVERRIDES, useValue: null },
  ],
  exports: [AiModels, AiEmbeddingModels, AiTools, AiService],
})
export class AiModule extends ConfigurableModuleClass {
  static forRoot(options: AiModuleRootOptions): DynamicModule {
    // `@InjectModel()` may ask for every model `forRoot()` names.
    const modelNames = Object.keys(options?.models ?? {});
    const embeddingModelNames = Object.keys(options?.embeddingModels ?? {});
    return super.forRoot({ ...options, modelNames, embeddingModelNames } as typeof OPTIONS_TYPE);
  }

  static forRootAsync(options: AiModuleAsyncOptions): DynamicModule {
    return super.forRootAsync(options);
  }
}
