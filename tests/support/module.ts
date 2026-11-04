import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AiModule, AiService, type AiModuleRootOptions } from '../../lib/index.js';

/** A compiled, initialized testing module with `AiModule.forRoot(options)`, and its `AiService`. */
export async function createAi(
  options: AiModuleRootOptions,
  { providers = [], imports = [] }: { providers?: Provider[]; imports?: Array<Type<unknown> | DynamicModule> } = {},
): Promise<{ moduleRef: TestingModule; ai: AiService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AiModule.forRoot(options), ...imports], providers }).compile();
  moduleRef.useLogger(false);
  await moduleRef.init();
  return { moduleRef, ai: moduleRef.get(AiService) };
}
