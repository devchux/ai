/**
 * Agent functions called by the application's agent, on every HTTP platform: the caller's identity, guards,
 * interceptors, pipes and filters, refusals and errors as the model reads them, scopes, and one method served to MCP
 * clients by `@Tool()` and to the agent by `@AgentFunction()`, whose enhancers tell the two by the context type.
 */
import type { INestApplication } from '@nestjs/common';
import { connectMcpClient } from '@nestjs/mcp/testing';
import { FakeModel, overrideModels, type FakeModelCall } from '../lib/testing/index.js';
import { CallLog, StoreModule } from './fixtures/store/store.module.js';
import { adapters, createApp, urlOf } from './support/adapters.js';

/** What the model was told about the tool calls of the previous step. */
const toolOutputs = (call: FakeModelCall) => call.toolResults.map((result) => result.output);

describe.each(adapters.map((adapter) => adapter.name))('tools on %s', (adapter) => {
  let app: INestApplication;
  let url: URL;
  let log: CallLog;
  const model = new FakeModel([]);

  beforeAll(async () => {
    app = await createApp(adapter, StoreModule, { override: (builder) => overrideModels(builder, { default: model }) });
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

  async function ask(body: { message: string; tools?: string[] }, headers: Record<string, string> = {}) {
    const response = await fetch(new URL('/assistant', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as { text: string; toolResults: any[]; steps: number } };
  }

  /** The model calls `tool` with `input`, then answers with what it was told. */
  function callsTool(name: string, input: unknown = {}) {
    model.reply({ toolCalls: [{ name, input }] }, (call) => JSON.stringify(toolOutputs(call)[0]));
  }

  it("runs an agent function as the caller, and answers with what the model made of it", async () => {
    model.reply(
      { toolCalls: [{ name: 'find-order', input: { orderId: 'ord_1' } }] },
      (call) => {
        const order = toolOutputs(call)[0] as { id: string; status: string };
        return `Order ${order.id} has ${order.status}.`;
      },
    );
    const { status, body } = await ask({ message: 'Where is ord_1?' }, { 'x-user': 'alice' });

    expect(status).toBe(201);
    expect(body).toMatchObject({ text: 'Order ord_1 has shipped.', steps: 2 });
    expect(body.toolResults).toEqual([
      expect.objectContaining({ toolName: 'find-order', input: { orderId: 'ord_1' }, output: { id: 'ord_1', status: 'shipped' } }),
    ]);
    expect(log.entries).toEqual([
      'global guard http',
      'global guard ai find-order',
      'roles guard find-order as alice',
      'find-order ord_1 for alice (ai)',
    ]);
    // The model is offered the agent functions the call lists, as tools, and no other.
    expect(model.calls.map((call) => call.tools)).toEqual([['find-order'], ['find-order']]);
    expect(model.calls[0]!.instructions).toBe('You help customers of the cat store with their orders.');
  });

  it("tells the model a guard refused the call, and runs it for a caller the guard lets through", async () => {
    callsTool('change-address', { orderId: 'ord_2', address: '  9 Mouse Road, Whiskerton  ' });
    const refused = await ask({ message: 'Move ord_2', tools: ['change-address'] }, { 'x-user': 'alice' });
    expect(refused.body.text).toBe('"Forbidden resource"');
    expect(refused.body.toolResults).toEqual([expect.objectContaining({ toolName: 'change-address', error: 'Forbidden resource' })]);
    expect(log.entries).not.toContain('change-address "9 Mouse Road, Whiskerton"');

    log.clear();
    callsTool('change-address', { orderId: 'ord_2', address: '  9 Mouse Road, Whiskerton  ' });
    const allowed = await ask({ message: 'Move ord_2', tools: ['change-address'] }, { 'x-user': 'sam' });
    expect(JSON.parse(allowed.body.text)).toMatchObject({ id: 'ord_2', address: '9 Mouse Road, Whiskerton' });
    expect(log.entries).toEqual([
      'global guard http',
      'global guard ai change-address',
      'roles guard change-address as sam',
      'interceptor before change-address',
      'pipe body',
      'pipe custom',
      'change-address "9 Mouse Road, Whiskerton"',
      'interceptor after change-address',
    ]);
  });

  it('validates the input against the schema before any enhancer or the method runs', async () => {
    callsTool('change-address', { orderId: 'ord_2', address: 'short' });
    const { body } = await ask({ message: 'Move ord_2', tools: ['change-address'] }, { 'x-user': 'sam' });
    expect(body.toolResults[0].error).toContain('address');
    expect(body.toolResults[0].error).toContain('Too small');
    expect(log.entries).toEqual(['global guard http']);
  });

  it("never tells the model an error's own message", async () => {
    callsTool('explode');
    const { body } = await ask({ message: 'Read the database', tools: ['explode'] });
    expect(body.toolResults[0].error).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(model.calls.map((call) => call.options.prompt))).not.toContain('hunter2');
  });

  it("tells the model an HttpException's message", async () => {
    callsTool('forbidden');
    const { body } = await ask({ message: 'Try it', tools: ['forbidden'] });
    expect(body.toolResults[0].error).toBe('Not your order');
  });

  it('lets a filter answer with an output of its own', async () => {
    callsTool('charge');
    const { body } = await ask({ message: 'Charge me', tools: ['charge'] });
    expect(body.toolResults[0].output).toEqual({ error: 'Payments are down; charge can be retried in a few minutes.' });
  });

  it("checks an agent function's scopes against the caller's, before its guards", async () => {
    callsTool('refund', { orderId: 'ord_1' });
    const refused = await ask({ message: 'Refund ord_1', tools: ['refund'] }, { 'x-user': 'sam' });
    expect(refused.body.toolResults[0].error).toBe('Forbidden: this tool needs the scope(s) orders:refund');
    expect(log.entries).toEqual(['global guard http']);

    callsTool('refund', { orderId: 'ord_1' });
    const allowed = await ask({ message: 'Refund ord_1', tools: ['refund'] }, { 'x-user': 'sam', 'x-scopes': 'orders:read orders:refund' });
    expect(allowed.body.toolResults[0].output).toEqual({ refunded: 'ord_1' });
  });

  it('gives custom parameter decorators and the context the caller', async () => {
    callsTool('whoami');
    const { body } = await ask({ message: 'Who am I?', tools: ['whoami'] }, { 'x-user': 'alice' });
    expect(body.toolResults[0].output).toEqual({ user: 'alice', toolCallId: expect.stringMatching(/^call-/), sawRequest: true });

    callsTool('whoami');
    const anonymous = await ask({ message: 'Who am I?', tools: ['whoami'] });
    expect(anonymous.body.toolResults[0].output).toMatchObject({ user: null, sawRequest: true });
  });

  it('serves the method that also has @Tool() to MCP clients, and only it, with the context type "mcp"', async () => {
    const client = await connectMcpClient(app);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['find-order']);
      const result = await client.callTool({ name: 'find-order', arguments: { orderId: 'ord_1' } });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual({ id: 'ord_1', status: 'shipped' });
      // The same guards and parameter decorators run for MCP clients' calls, which they read as 'mcp' calls.
      expect(log.entries).toEqual(['global guard mcp find-order', 'roles guard find-order as nobody', 'find-order ord_1 for nobody (mcp)']);
    } finally {
      await client.close();
    }
  });

  it('lets a guard of a method that serves both consumers tell them apart by the context type', async () => {
    // Through the agent, alice finds her own orders only.
    callsTool('find-order', { orderId: 'ord_2' });
    const refused = await ask({ message: 'Where is ord_2?' }, { 'x-user': 'alice' });
    expect(refused.body.toolResults).toEqual([expect.objectContaining({ toolName: 'find-order', error: 'Forbidden resource' })]);
    expect(log.entries).not.toContain('find-order ord_2 for alice (ai)');

    // The support team's MCP clients find every order.
    const client = await connectMcpClient(app);
    try {
      const result = await client.callTool({ name: 'find-order', arguments: { orderId: 'ord_2' } });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual({ id: 'ord_2', status: 'packing' });
    } finally {
      await client.close();
    }
  });

  it('answers 500 when the model call fails, through the route\'s exception handling', async () => {
    model.reply(new Error('provider down'), new Error('provider down'));
    const { status } = await ask({ message: 'Hi' });
    expect(status).toBe(500);
  });
});
