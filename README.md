<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[travis-image]: https://api.travis-ci.org/nestjs/nest.svg?branch=master
[travis-url]: https://travis-ci.org/nestjs/nest
[linux-image]: https://img.shields.io/travis/nestjs/nest/master.svg?label=linux
[linux-url]: https://travis-ci.org/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/dm/@nestjs/core.svg" alt="NPM Downloads" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec"><img src="https://img.shields.io/badge/Donate-PayPal-dc3d53.svg"/></a>
  <a href="https://twitter.com/nestframework"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Language models for [Nest](https://github.com/nestjs/nest): named models through dependency injection, model calls with timeouts, retries and fallback models (run on [`@nestjs/resilience`](https://github.com/nestjs/resilience) policies, or your own), budgets and usage events, structured output validated by a schema, the application's own provider methods as agent functions its agents call (through Nest's guards, interceptors, pipes and exception filters, as the user the agent acts for), answers streamed to the browser on Express, Fastify and the Node adapter, and durable agent runs on [`@nestjs/workflows`](https://github.com/nestjs/workflows) (`@nestjs/ai/workflows`) that survive restarts and wait for a person's approval. You write an agent function with `@AgentFunction()`, and the model is offered it as a tool; a method can be an MCP tool too, served by [`@nestjs/mcp`](https://github.com/nestjs/mcp), with its `@Tool()` stacked on it. Embedding models have their own named registry, dependency injection, resilient single and batch calls, and usage events. Comes with fake language and embedding models for tests. Built on the [AI SDK](https://ai-sdk.dev) (`ai`) and its provider packages.

## Installation

```bash
$ npm i --save @nestjs/ai @nestjs/resilience ai @ai-sdk/anthropic zod
```

Any `@ai-sdk/*` provider package works (`@ai-sdk/openai`, `@ai-sdk/google`, ...). Zod 4.2 or later for the schemas; any other [Standard Schema](https://standardschema.dev) library that produces JSON Schema works too. Node.js 22 or later.

Each major version of `@nestjs/ai` supports one major version of the AI SDK: this one, `ai` 7.

## Quick Start

Register the models, and call them:

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { Injectable, Module } from '@nestjs/common';
import { AgentFunction, AiModule, AiService, type AgentFunctionContext } from '@nestjs/ai';
import * as z from 'zod';

@Injectable()
export class OrdersTools {
  constructor(private readonly orders: OrdersService) {}

  @AgentFunction({
    name: 'find-order',
    description: 'Find an order by its id',
    inputSchema: z.object({ orderId: z.string() }),
  })
  find({ orderId }: { orderId: string }, ctx: AgentFunctionContext) {
    return this.orders.findFor(ctx.request?.user, orderId);
  }
}

@Injectable()
export class SupportService {
  constructor(private readonly ai: AiService) {}

  async answer(question: string, request: unknown) {
    const { text } = await this.ai.generateText({
      prompt: question,
      tools: ['find-order'],
      caller: { request },
    });
    return text;
  }
}

@Module({
  imports: [
    AiModule.forRoot({
      models: {
        default: anthropic('claude-opus-5-5'),
        fast: anthropic('claude-haiku-5-5'),
      },
      defaults: { timeout: '30s', retry: { attempts: 3 } },
    }),
  ],
  providers: [OrdersService, OrdersTools, SupportService],
})
export class AppModule {}
```

A method that MCP clients call too also carries `@nestjs/mcp`'s `@Tool()`, with options of its own: the two decorators don't read each other's, and one schema constant serves both. `generateObject({ schema })` answers a typed object, and `streamText()` an answer a controller sends to the browser with `pipeUIMessageStreamToResponse(res)`, as the AI SDK's `useChat()` reads it. Agent function calls run through the guards, interceptors, pipes and filters of the class and the method, with the context type `'ai'`, so `AiExecutionContext` reads them in enhancers (on a method with both decorators, they see `'mcp'` for MCP clients' calls), and `@nestjs/authentication` (0.1.4 or later) and `@nestjs/authorization` (0.1.2 or later) authenticate and authorize them. `@nestjs/ai/testing` has `FakeModel`, which answers with text, tool calls, objects or errors, without a network.

The [sample](sample) is a cat store: it triages support emails, and runs a chat assistant that calls the same `find-order` method its MCP server serves. `npm run build && npx tsc -p sample/tsconfig.json`, then `node sample/dist/main.js` (with `ANTHROPIC_API_KEY` set, Claude answers; without it, fake models do).

Read [Overview](https://docs.nestjs.com/ai/overview) to get started and for the module's options, [Models](https://docs.nestjs.com/ai/models) for retries, timeouts, fallback models and budgets, [Tools](https://docs.nestjs.com/ai/tools) for agent functions, the call context, guards and authorization, [Agents](https://docs.nestjs.com/ai/agents) for the agent loop, streaming to the browser and durable runs, and [Testing](https://docs.nestjs.com/ai/testing) for the fake model.

## Embedding models

Register embedding models separately from language models. Either registry can be used alone, and both may contain a model named `default`:

```ts
import { Module, Injectable } from '@nestjs/common';
import { openai } from '@ai-sdk/openai';
import { AiModule, AiService, InjectEmbeddingModel } from '@nestjs/ai';
import type { EmbeddingModel } from 'ai';

@Injectable()
export class DocumentsService {
  constructor(private readonly ai: AiService) {}

  async index(contents: string[]) {
    const { embeddings, usage, model } = await this.ai.embedMany({
      model: 'documents',
      values: contents,
      label: 'document-indexing',
    });
    return { embeddings, tokens: usage.tokens, model };
  }

  async searchVector(question: string, signal?: AbortSignal) {
    return (await this.ai.embed({ value: question, abortSignal: signal })).embedding;
  }
}

@Injectable()
export class DirectSdkConsumer {
  constructor(@InjectEmbeddingModel('documents') readonly model: EmbeddingModel) {}
}

@Module({
  imports: [
    AiModule.forRoot({
      embeddingModels: {
        default: openai.embeddingModel('text-embedding-3-small'),
        documents: {
          model: openai.embeddingModel('text-embedding-3-small'),
          // Illustrative input-token price per million; use the provider's actual price.
          pricing: { input: 0.02 },
        },
      },
      embeddingDefaults: {
        timeout: '30s',
        retry: { attempts: 3 },
        maxParallelCalls: 4,
      },
    }),
  ],
  providers: [DocumentsService, DirectSdkConsumer],
  exports: [DocumentsService, DirectSdkConsumer],
})
export class EmbeddingsModule {}
```

Install the provider package used by your application (`@ai-sdk/openai` in this example). Registration makes no network calls. Omitting `model` selects the embedding model named `default`; the first registered model is never selected implicitly. A call may also pass an SDK embedding-model object directly. `AiEmbeddingModels` exposes the registry's `get()`, `has()` and `names()` methods. Direct SDK calls with an injected model do not receive `AiService` policies or usage events.

`forRootAsync()` accepts the same factories as language-model configuration. Embedding injection names are discovered from decorators when the module is defined; list `embeddingModelNames` at the top level for classes loaded later. Export `AiModule` from an application module or set `isGlobal: true` to share its providers.

Embedding settings use the call's options first, then the registered model's settings, then `embeddingDefaults`, then built-in defaults. Existing language-model `defaults` are independent, including their headers and provider options. Embedding calls accept provider options and headers. Configure dimensions through the provider's `providerOptions`; a top-level dimensions setting is omitted to preserve compatibility with AI SDK 7.0.0. Results preserve SDK usage (`{ tokens }`), warnings and provider metadata, together with model identity, operation attempt count and optional cost.

The SDK handles provider-specific batching and returns vectors in input order. `maxParallelCalls` defaults to 4 and limits concurrent provider requests within one `embedMany()` operation. Shared custom resilience policies or named presets can limit concurrent operations within an application process. They do not coordinate quotas across replicas. For large ingestion jobs, submit bounded groups through application workers or queues rather than one unbounded array.

Nest owns retries and disables SDK retries. Built-in policies use three attempts and a 60-second timeout per attempt unless configured otherwise; a custom `resilience` policy or preset replaces them. Each attempt covers the entire operation, including all its batches. Retrying a failed batch operation may recompute earlier successful batches and incur additional charges. Calls return a complete result or reject. Caller cancellation stops in-flight requests and retry backoff. Automatic switching between embedding models is not supported: matching dimensions do not establish compatibility with an existing index.

Use module-level or call-level `onEmbeddingUsage` to observe successful operations. Events contain operation type, label, model identity, input count, token usage, attempt count, duration and optional input-token cost. Existing `onUsage` callbacks remain specific to language-model operations. Listener errors are logged without failing the operation. Events exclude document contents and vectors. Success usage is not a complete billing ledger for partial failures or retries; absent pricing leaves cost unknown.

Test without a provider connection:

```ts
import { Test } from '@nestjs/testing';
import { AiService } from '@nestjs/ai';
import { FakeEmbeddingModel, overrideEmbeddingModels } from '@nestjs/ai/testing';

const fake = new FakeEmbeddingModel([
  { embeddings: [[0.1, 0.2]], usage: { tokens: 3 } },
]);
const moduleRef = await overrideEmbeddingModels(
  Test.createTestingModule({ imports: [EmbeddingsModule] }),
  { default: fake },
).compile();

const result = await moduleRef.get(AiService).embed({ value: 'A document' });
expect(result.embedding).toEqual([0.1, 0.2]);
expect(fake.lastCall?.values).toEqual(['A document']);
await moduleRef.close();
```

`FakeEmbeddingModel` records provider calls and accepts scripted vectors, errors, delays, or a function of each call. Its provider batch limits and parallel-call support can exercise SDK batching. `overrideEmbeddingModels()` preserves model settings and pricing, independently of `overrideModels()`. Vector storage, document chunking, RAG orchestration, caching, embedding budgets and partial-result recovery remain application responsibilities.

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).
