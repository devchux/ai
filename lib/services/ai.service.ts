import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ResilienceService, type ResiliencePolicy } from '@nestjs/resilience';
import type { ModelMessage, UIMessageChunk } from 'ai';
import { AI_MODULE_OPTIONS } from '../ai.constants.js';
import { AiConfigurationError, AiOutputError } from '../errors/ai.errors.js';
import type { AiCallOptions, AiObjectCallOptions } from '../interfaces/ai-call-options.interface.js';
import type { AiModuleOptions } from '../interfaces/ai-module-options.interface.js';
import type { AiObjectResult, AiTextResult } from '../interfaces/ai-result.interface.js';
import type { AiSchema, InferSchemaOutput } from '../interfaces/ai-schema.interface.js';
import type { AiUsageEvent } from '../interfaces/ai-usage.interface.js';
import { AiModels } from '../models/ai-models.service.js';
import { runLoop, usageEvent } from '../runtime/agent-loop.js';
import { createCallPlan, type CallPlan } from '../runtime/call-plan.js';
import { runStep } from '../runtime/model-policy.js';
import { generateStep, type StepOutcome } from '../runtime/steps.js';
import { AiTextStream } from '../runtime/text-stream.js';
import { AiTools } from '../tools/ai-tools.service.js';
import { toModelSchema } from '../utils/schema.util.js';

const NEVER_ABORTED = new AbortController().signal;

/**
 * Model calls: text, structured output and streams, with the application's agent functions as tools, through the
 * configured models, with timeouts, retries, fallback, budgets and usage events.
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
  ) {}

  /** Generates text; with `tools`, calls them as the model asks, and answers when it is done. */
  async generateText(options: AiCallOptions): Promise<AiTextResult> {
    const plan = this.plan(options, options?.abortSignal ?? NEVER_ABORTED);
    const { result } = await runLoop(plan, { stream: false }, (event) => this.report(plan, event));
    return result;
  }

  /**
   * Generates an object that matches `schema`: an invoice from an email, a triage decision from a ticket. Rejects
   * with `AiOutputError` when the answer does not match it.
   */
  async generateObject<S extends AiSchema>(options: AiObjectCallOptions<S>): Promise<AiObjectResult<InferSchemaOutput<S>>> {
    const schema = toModelSchema(options?.schema, 'generateObject() `schema`');
    const plan = this.plan(options, options.abortSignal ?? NEVER_ABORTED);
    const { result, output } = await runLoop(
      plan,
      {
        stream: false,
        output: {
          schema,
          ...(options.schemaName !== undefined && { name: options.schemaName }),
          ...(options.schemaDescription !== undefined && { description: options.schemaDescription }),
        },
      },
      (event) => this.report(plan, event),
    );
    if (output === undefined) {
      throw new AiOutputError(
        `The model was still calling tools after ${plan.maxSteps} step(s), and gave no answer. Raise \`maxSteps\`.`,
        result.text,
      );
    }
    return { ...result, object: output as InferSchemaOutput<S> };
  }

  /**
   * Streams text: the call starts now, and its answer can be sent to the browser as it is generated
   * (`pipeUIMessageStreamToResponse(res)`), read (`textStream`) or awaited (`text`). Mistakes in the options throw
   * here; failures of the call reach the stream.
   */
  streamText(options: AiCallOptions): AiTextStream {
    const controller = new AbortController();
    const signal = options?.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
    const plan = this.plan(options, signal);
    return new AiTextStream(controller, async (emit) => {
      const { result, finish } = await runLoop(plan, { stream: true, emit }, (event) => this.report(plan, event));
      emit(finish ?? ({ type: 'finish', finishReason: result.finishReason } as UIMessageChunk));
      return result;
    });
  }

  /**
   * @internal One model call of a durable run (`@nestjs/ai/workflows`), with `messages` so far: the tools are offered
   * and their calls returned, not run. Retries, timeouts, fallback and usage events as for any call.
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

  /** A preset of the application's `ResilienceService`, which `ResilienceModule.forRoot({ presets })` configures. */
  private preset(name: string): ResiliencePolicy {
    let service: ResilienceService;
    try {
      service = this.moduleRef.get(ResilienceService, { strict: false });
    } catch {
      throw new AiConfigurationError(
        `\`resilience: '${name}'\` names a preset of ResilienceService, and the application does not import ResilienceModule.`,
      );
    }
    return service.preset(name);
  }

  /** Calls the usage listeners. They never fail the call: what they throw is logged. */
  private report(plan: CallPlan, event: AiUsageEvent): void {
    for (const listener of plan.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) => this.logListenerError(error));
      } catch (error) {
        this.logListenerError(error);
      }
    }
  }

  private logListenerError(error: unknown) {
    this.logger.error(`onUsage failed: ${(error as Error)?.message ?? String(error)}`, (error as Error)?.stack);
  }
}
