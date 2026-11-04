/**
 * The module: named models, `@InjectModel()`, async configuration, and the mistakes it refuses at startup.
 */
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LanguageModel } from 'ai';
import { AiConfigurationError, AiModels, AiModule, AiService, getModelToken, InjectModel } from '../lib/index.js';
import { FakeModel, overrideModels } from '../lib/testing/index.js';

@Injectable()
class UsesModels {
  constructor(
    @InjectModel() readonly main: LanguageModel,
    @InjectModel('fast') readonly fast: LanguageModel,
    readonly ai: AiService,
  ) {}
}

describe('AiModule', () => {
  it('registers named models, injects them, and calls the default one', async () => {
    const main = new FakeModel(['Hello from the default model']);
    const fast = new FakeModel(['Hello from the fast model']);
    const moduleRef = await Test.createTestingModule({
      imports: [AiModule.forRoot({ models: { default: main, fast: { model: fast, pricing: { input: 1, output: 2 } } } })],
      providers: [UsesModels],
    }).compile();
    await moduleRef.init();

    const service = moduleRef.get(UsesModels);
    expect(service.main).toBe(main);
    expect(service.fast).toBe(fast);
    expect(moduleRef.get(AiModels).names()).toEqual(['default', 'fast']);
    expect((await service.ai.generateText({ prompt: 'Hi' })).text).toBe('Hello from the default model');
    expect((await service.ai.generateText({ model: 'fast', prompt: 'Hi' })).text).toBe('Hello from the fast model');
    await moduleRef.close();
  });

  it('is not global unless isGlobal: true; a module of yours can import it and export it', async () => {
    @Module({ providers: [UsesModels], exports: [UsesModels] })
    class FeatureModule {}
    const models = () => ({ default: new FakeModel(['a']), fast: new FakeModel(['b']) });

    // The feature module does not see the module's providers.
    await expect(
      Test.createTestingModule({ imports: [AiModule.forRoot({ models: models() }), FeatureModule] }).compile(),
    ).rejects.toThrow(/UsesModels/);

    const global = await Test.createTestingModule({
      imports: [AiModule.forRoot({ models: models(), isGlobal: true }), FeatureModule],
    }).compile();
    expect(global.get(UsesModels).ai).toBeInstanceOf(AiService);
    await global.close();

    @Module({ imports: [AiModule.forRoot({ models: models() })], exports: [AiModule] })
    class LlmModule {}
    @Module({ imports: [LlmModule], providers: [UsesModels] })
    class ReexportingFeatureModule {}
    const reexported = await Test.createTestingModule({ imports: [ReexportingFeatureModule] }).compile();
    expect(reexported.get(UsesModels).fast).toBeInstanceOf(FakeModel);
    await reexported.close();
  });

  it('takes its options from a factory, and injects the models @InjectModel() asks for', async () => {
    @Injectable()
    class ModelConfig {
      readonly main = new FakeModel(['from the factory']);
      readonly fast = new FakeModel(['fast, from the factory']);
    }
    @Module({ providers: [ModelConfig], exports: [ModelConfig] })
    class ConfigModule {}

    // No `modelNames`: the module was defined after the decorators of UsesModels ran.
    const moduleRef = await Test.createTestingModule({
      imports: [
        AiModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ModelConfig],
          useFactory: (config: ModelConfig) => ({ models: { default: config.main, fast: config.fast } }),
        }),
      ],
      providers: [UsesModels],
    }).compile();
    await moduleRef.init();
    const config = moduleRef.get(ModelConfig);
    expect(moduleRef.get(UsesModels).main).toBe(config.main);
    expect(moduleRef.get(UsesModels).fast).toBe(config.fast);
    expect(await moduleRef.resolve(getModelToken('fast'))).toBe(config.fast);
    expect((await moduleRef.get(AiService).generateText({ prompt: 'Hi' })).text).toBe('from the factory');
    await moduleRef.close();
  });

  it('refuses at startup a model @InjectModel() asks for and the module does not configure, naming the class', async () => {
    @Injectable()
    class UsesTypo {
      constructor(@InjectModel('fats') readonly model: LanguageModel) {}
    }

    await expect(
      Test.createTestingModule({ imports: [AiModule.forRoot({ models: { default: new FakeModel([]) } })], providers: [UsesTypo] }).compile(),
    ).rejects.toThrow('UsesTypo: @InjectModel(\'fats\') asks for a model AiModule does not configure. Configured: default. Add "fats" to `models`');

    await expect(
      Test.createTestingModule({
        imports: [AiModule.forRootAsync({ useFactory: () => ({ models: { default: new FakeModel([]) } }) })],
        providers: [UsesModels],
      }).compile(),
    ).rejects.toThrow(/UsesModels: @InjectModel\('fast'\) asks for a model AiModule does not configure/);
  });

  it('replaces models by name in tests, keeping their options', async () => {
    const real = new FakeModel(['the real model']);
    const fake = new FakeModel(['the fake model']);
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AiModule.forRoot({ models: { default: { model: real, pricing: { input: 1_000_000, output: 0 } } } })] }),
      { default: fake },
    ).compile();
    await moduleRef.init();

    const result = await moduleRef.get(AiService).generateText({ prompt: 'Hi' });
    expect(result.text).toBe('the fake model');
    expect(result.cost).toBe(10); // 10 input tokens at 1,000,000 per million: the real model's pricing
    expect(real.calls).toHaveLength(0);
    await moduleRef.close();
  });

  it('refuses no models, unknown fallbacks and overrides of models it does not have', async () => {
    const compile = (options: Parameters<typeof AiModule.forRoot>[0], overrides?: Record<string, LanguageModel>) => {
      const builder = Test.createTestingModule({ imports: [AiModule.forRoot(options)] });
      return (overrides ? overrideModels(builder, overrides) : builder).compile();
    };
    await expect(compile({ models: {} })).rejects.toThrow(AiConfigurationError);
    await expect(compile({ models: { default: { model: new FakeModel([]), fallback: 'backup' } } })).rejects.toThrow(
      'falls back to "backup", which is not configured',
    );
    await expect(compile({ models: { default: 'not a model' as never as LanguageModel } })).resolves.toBeDefined();
    await expect(compile({ models: { default: {} as LanguageModel } })).rejects.toThrow('is not a language model');
    await expect(compile({ models: { default: new FakeModel([]) } }, { other: new FakeModel([]) })).rejects.toThrow(
      'there is no model "other" to override',
    );
  });

  it('refuses a call that names a model it does not have', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AiModule.forRoot({ models: { default: new FakeModel([]) } })] }).compile();
    await expect(moduleRef.get(AiService).generateText({ model: 'gpt', prompt: 'Hi' })).rejects.toThrow(
      'There is no model named "gpt". Configured: default.',
    );
    await moduleRef.close();
  });
});
