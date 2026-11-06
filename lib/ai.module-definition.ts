import {
  ConfigurableModuleBuilder,
  Scope,
  type ConfigurableModuleAsyncOptions,
  type Provider,
} from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';
import type {
  AiModuleOptions,
  AiModuleStructure,
  AiOptionsFactory,
} from './interfaces/ai-module-options.interface.js';
import { AI_MODULE_OPTIONS, getEmbeddingModelToken, getModelToken } from './ai.constants.js';
import { AiModels } from './models/ai-models.service.js';
import { AiEmbeddingModels } from './models/ai-embedding-models.service.js';
import { requestedEmbeddingModelNames, requestedModelNames } from './models/model-requests.js';

/** `forRoot()`'s options: the module options, and `isGlobal` (default false). */
export type AiModuleRootOptions = AiModuleOptions & { isGlobal?: boolean };

/**
 * What `forRootAsync()` takes: `modelNames`, `embeddingModelNames` and `isGlobal` at the top level,
 * and one of `useFactory`, `useClass` or `useExisting` for the options.
 */
export type AiModuleAsyncOptions = ConfigurableModuleAsyncOptions<
  AiModuleOptions,
  'createAiOptions'
> &
  AiModuleStructure & { isGlobal?: boolean };

export type { AiOptionsFactory };

export { AI_MODULE_OPTIONS };

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<AiModuleOptions>({
    moduleName: 'Ai',
    optionsInjectionToken: AI_MODULE_OPTIONS,
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('createAiOptions')
    .setExtras<AiModuleStructure & { isGlobal?: boolean }>(
      { isGlobal: false, modelNames: undefined, embeddingModelNames: undefined },
      (definition, { isGlobal, modelNames, embeddingModelNames }) => {
        const names = new Set([...(modelNames ?? []), ...requestedModelNames()]);
        // Transient, so that each class that injects a model is known (INQUIRER), and one that asks
        // for a model the module does not configure is named in the error.
        const tokens = [...names].map((name): Provider => ({
          provide: getModelToken(name),
          scope: Scope.TRANSIENT,
          inject: [AiModels, INQUIRER],
          useFactory: (models: AiModels, inquirer: unknown) => models.injected(name, inquirer),
        }));
        const embeddingNames = new Set([
          ...(embeddingModelNames ?? []),
          ...requestedEmbeddingModelNames(),
        ]);
        const embeddingTokens = [...embeddingNames].map((name): Provider => ({
          provide: getEmbeddingModelToken(name),
          scope: Scope.TRANSIENT,
          inject: [AiEmbeddingModels, INQUIRER],
          useFactory: (models: AiEmbeddingModels, inquirer: unknown) =>
            models.injected(name, inquirer),
        }));
        const allTokens = [...tokens, ...embeddingTokens];
        return {
          ...definition,
          global: isGlobal,
          providers: [...(definition.providers ?? []), ...allTokens],
          exports: [
            ...(definition.exports ?? []),
            ...allTokens.map((provider) => (provider as { provide: string }).provide),
          ],
        };
      },
    )
    .build();
