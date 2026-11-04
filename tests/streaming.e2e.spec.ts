/**
 * Streamed answers on every HTTP platform: the AI SDK's UI message stream (what `useChat()` reads) and plain text,
 * across tool steps, with retries before the first chunk, failures before and after it, and a browser that goes away.
 */
import type { INestApplication } from '@nestjs/common';
import { DefaultChatTransport, readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { FakeModel, overrideModels, providerError } from '../lib/testing/index.js';
import { CallLog, StoreModule } from './fixtures/store/store.module.js';
import { adapters, createApp, urlOf } from './support/adapters.js';
import { parseSse, typesOf } from './support/sse.js';

describe.each(adapters.map((adapter) => adapter.name))('streaming on %s', (adapter) => {
  let app: INestApplication;
  let url: URL;
  let log: CallLog;
  const model = new FakeModel([]);

  beforeAll(async () => {
    app = await createApp(adapter, StoreModule, {
      override: (builder) => overrideModels(builder, { default: model }),
      setup: (app) => void app.enableCors({ origin: 'https://store.example' }),
    });
    url = await urlOf(app);
    log = app.get(CallLog);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    log.clear();
    model.calls.length = 0;
  });

  const post = (path: string, body: object, init: RequestInit = {}) =>
    fetch(new URL(path, url), {
      method: 'POST',
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
      body: JSON.stringify(body),
    });

  it('streams the tool step and the answer as one UI message, as useChat() reads it', async () => {
    model.reply({ toolCalls: [{ name: 'find-order', input: { orderId: 'ord_1' } }] }, 'Your order has shipped.');
    const response = await post('/assistant/stream', { message: 'Where is ord_1?' }, { headers: { 'x-user': 'alice', origin: 'https://store.example' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('x-assistant')).toBe('cat-store');
    // Set by CORS before the stream started: kept on Fastify too, whose reply is hijacked.
    expect(response.headers.get('access-control-allow-origin')).toBe('https://store.example');

    const chunks = parseSse(await response.text());
    const types = typesOf(chunks);
    expect(types.filter((type) => type === 'start')).toHaveLength(1);
    expect(types.filter((type) => type === 'finish')).toHaveLength(1);
    expect(types[0]).toBe('start');
    expect(types.slice(-2)).toEqual(['finish', '[DONE]']);
    expect(types.filter((type) => type === 'start-step')).toHaveLength(2);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-output-available', output: { id: 'ord_1', status: 'shipped' } }));
    expect(chunks.at(-2)).toMatchObject({ type: 'finish', finishReason: 'stop' });
    expect(log.entries).toContain('find-order ord_1 for alice (ai)');

    // What the browser's useChat() builds from it.
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.filter((chunk) => chunk !== '[DONE]').forEach((chunk) => controller.enqueue(chunk as UIMessageChunk));
        controller.close();
      },
    });
    let message: UIMessage | undefined;
    for await (const state of readUIMessageStream({ stream })) {
      message = state;
    }
    const parts = message!.parts.filter((part) => part.type !== 'step-start');
    expect(parts).toEqual([
      expect.objectContaining({ type: 'tool-find-order', state: 'output-available', output: { id: 'ord_1', status: 'shipped' } }),
      expect.objectContaining({ type: 'text', text: 'Your order has shipped.' }),
    ]);
  });

  it("streams a guard's refusal as the tool's error, and the model's answer after it", async () => {
    model.reply({ toolCalls: [{ name: 'change-address', input: { orderId: 'ord_2', address: '9 Mouse Road, Whiskerton' } }] }, 'I cannot do that.');
    const response = await post('/assistant/stream', { message: 'Move ord_2', tools: ['change-address'] }, { headers: { 'x-user': 'alice' } });
    const chunks = parseSse(await response.text());
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-output-error', errorText: 'Forbidden resource' }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'cannot ' }));
  });

  it('streams the text alone', async () => {
    model.reply('Salmon kibble is back in stock.');
    const response = await post('/assistant/text', { message: 'Is the salmon kibble back?' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Salmon kibble is back in stock.');
  });

  it('sends chunks as they are generated', async () => {
    model.reply({ text: 'one two three four five', chunkDelay: 20 });
    const response = await post('/assistant/text', { message: 'Count' });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe('one ');
    // The model has more to say: the rest is still on its way.
    expect(model.lastCall!.options.abortSignal?.aborted).toBe(false);
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      rest += new TextDecoder().decode(value);
    }
    expect(first + rest).toBe('one two three four five');
  });

  it('retries a stream that fails before its first chunk, and the browser sees one answer', async () => {
    model.reply(providerError(529), 'Here you are.');
    const response = await post('/assistant/stream', { message: 'Hi', tools: [] });
    const chunks = parseSse(await response.text());
    expect(typesOf(chunks).filter((type) => type === 'error')).toEqual([]);
    expect(chunks.filter((chunk) => (chunk as UIMessageChunk).type === 'text-delta').map((chunk) => (chunk as { delta: string }).delta).join('')).toBe(
      'Here you are.',
    );
    expect(model.calls).toHaveLength(2);
  });

  it('answers a failure before the first chunk with an HTTP error, through the exception filters', async () => {
    model.reply(providerError(500), providerError(500));
    const response = await post('/assistant/stream', { message: 'Hi' });
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ statusCode: 500 });
  });

  it('ends with an error chunk when the stream breaks after its first chunk, without retrying it', async () => {
    model.reply({ text: 'Half an', streamError: providerError(500) });
    const response = await post('/assistant/stream', { message: 'Hi', tools: [] });
    const chunks = parseSse(await response.text());
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Half ' }));
    expect(chunks).toContainEqual({ type: 'error', errorText: 'An error occurred.' });
    expect(typesOf(chunks)).not.toContain('finish');
    expect(model.calls).toHaveLength(1);
  });

  it("keeps the connection alive while a tool runs, with comments useChat()'s transport skips", async () => {
    const ask: UIMessage = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Pack ord_1' }] };

    // The tool takes 300 ms: comments every 50 ms meanwhile.
    model.reply({ toolCalls: [{ name: 'pack-order' }] }, 'Packed.');
    const raw = await post('/assistant/chat', { messages: [ask], tools: ['pack-order'], keepAlive: 50 });
    const body = await raw.text();
    expect(body.match(/^: keep-alive$/gm)?.length).toBeGreaterThanOrEqual(2);
    expect(parseSse(body)).toContainEqual(expect.objectContaining({ type: 'tool-output-available', output: { packed: true } }));

    // What the browser reads: the AI SDK's own transport and message reader, comments and all.
    model.reply({ toolCalls: [{ name: 'pack-order' }] }, 'Packed.');
    const transport = new DefaultChatTransport<UIMessage>({
      api: new URL('/assistant/chat', url).href,
      body: { tools: ['pack-order'], keepAlive: 50 },
    });
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [ask],
      abortSignal: undefined,
    });
    let message: UIMessage | undefined;
    for await (const state of readUIMessageStream({ stream })) {
      message = state;
    }
    expect(message!.parts.filter((part) => part.type !== 'step-start')).toEqual([
      expect.objectContaining({ type: 'tool-pack-order', state: 'output-available', output: { packed: true } }),
      expect.objectContaining({ type: 'text', text: 'Packed.' }),
    ]);

    model.reply({ toolCalls: [{ name: 'pack-order' }] }, 'Packed.');
    const quiet = await post('/assistant/chat', { messages: [ask], tools: ['pack-order'], keepAlive: false });
    expect(await quiet.text()).not.toContain('keep-alive');
  });

  it('aborts the model call when the browser goes away', async () => {
    model.reply({ text: 'a very long answer that the user will not wait for', chunkDelay: 50 });
    const controller = new AbortController();
    const response = await post('/assistant/stream', { message: 'Tell me a story', tools: [] }, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(model.lastCall!.options.abortSignal?.aborted).toBe(true));
  });
});
