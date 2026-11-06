import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ResilienceService, type ResiliencePolicy } from '@nestjs/resilience';
import type { ModelMessage, UIMessageChunk } from 'ai';
import { AI_MODULE_OPTIONS } from '../ai.constants.js';
import { AiConfigurationError, AiOutputError } from '../errors/ai.errors.js';
import type {
  AiCallOptions,
  AiObjectCallOptions,
} from '../interfaces/ai-call-options.interface.js';
import type {
  AiEmbedOptions,
  AiEmbedManyOptions,
  AiEmbedResult,
  AiEmbedManyResult,
} from '../interfaces/ai-embedding.interface.js';
import type { AiModuleOptions } from '../interfaces/ai-module-options.interface.js';
import type { AiObjectResult, AiTextResult } from '../interfaces/ai-result.interface.js';
import type { AiSchema, InferSchemaOutput } from '../interfaces/ai-schema.interface.js';
import { AiModels } from '../models/ai-models.service.js';
import { AiEmbeddingModels } from '../models/ai-embedding-models.service.js';
import { runLoop, usageEvent } from '../runtime/agent-loop.js';
import { createCallPlan, type CallPlan } from '../runtime/call-plan.js';
import { createEmbeddingPlan, runEmbedding } from '../runtime/embedding-call.js';
import { runStep } from '../runtime/model-policy.js';
import { generateStep, type StepOutcome } from '../runtime/steps.js';
import { AiTextStream } from '../runtime/text-stream.js';
import { AiTools } from '../tools/ai-tools.service.js';
import { toModelSchema } from '../utils/schema.util.js';

const NEVER_ABORTED = new AbortController().signal;

/**
 * Model calls: text, structured output and streams, with the application's agent functions as
 * tools, through the configured models, with timeouts, retries, fallback, budgets and usage events.
 *
 * ```ts
 * const { text } = await this.ai.generateText({ prompt: 'Summarize this ticket: ...' });
 * ```
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AiModule');

  constructor(
    private readonly models: AiModels,
    private readonly tools: AiTools,
    @Inject(AI_MODULE_OPTIONS) private readonly options: AiModuleOptions,
    private readonly moduleRef: ModuleRef,
    private readonly embeddingModels: AiEmbeddingModels,
  ) {}

  /**
   * Embeds one string, with the embedding model's settings, Nest policies and embedding usage
   * events.
   */
  async embed(options: AiEmbedOptions): Promise<AiEmbedResult> {
    const plan = createEmbeddingPlan(options, this.embeddingModels, this.options, (name) =>
      this.preset(name),
    );
    const { result, event, attempts, cost } = await runEmbedding(plan, { value: options.value });
    this.report(plan, event, 'onEmbeddingUsage');
    return {
      value: result.value,
      embedding: result.embedding,
      usage: result.usage,
      warnings: result.warnings,
      ...(result.response !== undefined && { response: result.response }),
      ...(result.providerMetadata !== undefined && { providerMetadata: result.providerMetadata }),
      model: plan.model.info,
      attempts,
      ...(cost !== undefined && { cost }),
    };
  }

  /**
   * Embeds strings in input order; the SDK batches requests, with bounded concurrency (default 4).
   * Timeouts, retries and policies apply to each request.
   */
  async embedMany(options: AiEmbedManyOptions): Promise<AiEmbedManyResult> {
    const plan = createEmbeddingPlan(options, this.embeddingModels, this.options, (name) =>
      this.preset(name),
    );
    const { result, event, attempts, cost } = await runEmbedding(plan, { values: options.values });
    this.report(plan, event, 'onEmbeddingUsage');
    return {
      values: result.values,
      embeddings: result.embeddings,
      usage: result.usage,
      warnings: result.warnings,
      ...(result.responses !== undefined && { responses: result.responses }),
      ...(result.providerMetadata !== undefined && { providerMetadata: result.providerMetadata }),
      model: plan.model.info,
      attempts,
      ...(cost !== undefined && { cost }),
    };
  }

  /** Generates text; with `tools`, calls them as the model asks, and answers when it is done. */
  async generateText(options: AiCallOptions): Promise<AiTextResult> {
    const plan = this.plan(options, options?.abortSignal ?? NEVER_ABORTED);
    const { result } = await runLoop(plan, { stream: false }, (event) => this.report(plan, event));
    return result;
  }

  /**
   * Generates an object that matches `schema`: an invoice from an email, a triage decision from a
   * ticket. Rejects with `AiOutputError` when the answer does not match it.
   */
  async generateObject<S extends AiSchema>(
    options: AiObjectCallOptions<S>,
  ): Promise<AiObjectResult<InferSchemaOutput<S>>> {
    const schema = toModelSchema(options?.schema, 'generateObject() `schema`');
    const plan = this.plan(options, options.abortSignal ?? NEVER_ABORTED);
    const { result, output } = await runLoop(
      plan,
      {
        stream: false,
        output: {
          schema,
          ...(options.schemaName !== undefined && { name: options.schemaName }),
          ...(options.schemaDescription !== undefined && {
            description: options.schemaDescription,
          }),
        },
      },
      (event) => this.report(plan, event),
    );
    if (output === undefined) {
      throw new AiOutputError(
        `The model was still calling tools after ${plan.maxSteps} step(s), ` +
          'and gave no answer. Raise `maxSteps`.',
        result.text,
      );
    }
    return { ...result, object: output as InferSchemaOutput<S> };
  }

  /**
   * Streams text: the call starts now, and its answer can be sent to the browser as it is generated
   * (`pipeUIMessageStreamToResponse(res)`), read (`textStream`) or awaited (`text`). Mistakes in
   * the options throw here; failures of the call reach the stream.
   */
  streamText(options: AiCallOptions): AiTextStream {
    const controller = new AbortController();
    const signal = options?.abortSignal
      ? AbortSignal.any([options.abortSignal, controller.signal])
      : controller.signal;
    const plan = this.plan(options, signal);
    return new AiTextStream(controller, async (emit) => {
      const { result, finish } = await runLoop(plan, { stream: true, emit }, (event) =>
        this.report(plan, event),
      );
      emit(finish ?? ({ type: 'finish', finishReason: result.finishReason } as UIMessageChunk));
      return result;
    });
  }

  /**
   * @internal One model call of a durable run (`@nestjs/ai/workflows`), with `messages` so far: the
   * tools are offered and their calls returned, not run. Retries, timeouts, fallback and usage
   * events as for any call.
   */
  async callModel(
    options: AiCallOptions,
    { index, messages, signal }: { index: number; messages: ModelMessage[]; signal: AbortSignal },
  ): Promise<{ outcome: StepOutcome; attempts: number }> {
    const plan = this.plan({ ...options, prompt: undefined, messages }, signal, false);
    const { value, attempts } = await runStep(plan, async (attempt) => {
      const outcome = await generateStep(plan, index, plan.messages, attempt);
      this.report(plan, usageEvent(plan, attempt, outcome, false));
      return outcome;
    });
    return { outcome: value, attempts };
  }

  private plan(options: AiCallOptions, signal: AbortSignal, toolExecution = true): CallPlan {
    return createCallPlan(options, {
      models: this.models,
      tools: this.tools,
      moduleOptions: this.options,
      signal,
      preset: (name) => this.preset(name),
      toolExecution,
    });
  }

  /**
   * A preset of the application's `ResilienceService`, which `ResilienceModule.forRoot({ presets
   * })` configures.
   */
  private preset(name: string): ResiliencePolicy {
    let service: ResilienceService;
    try {
      service = this.moduleRef.get(ResilienceService, { strict: false });
    } catch {
      throw new AiConfigurationError(
        `\`resilience: '${name}'\` names a preset of ResilienceService, ` +
          'and the application does not import ResilienceModule.',
      );
    }
    return service.preset(name);
  }

  /** Calls the usage listeners. They never fail the call: what they throw is logged. */
  private report<T>(
    plan: { listeners: Array<(event: T) => void | Promise<void>> },
    event: T,
    hook = 'onUsage',
  ): void {
    for (const listener of plan.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) =>
          this.logListenerError(error, hook),
        );
      } catch (error) {
        this.logListenerError(error, hook);
      }
    }
  }

  private logListenerError(error: unknown, hook: string) {
    this.logger.error(
      `${hook} failed: ${(error as Error)?.message ?? String(error)}`,
      (error as Error)?.stack,
    );
  }
}
