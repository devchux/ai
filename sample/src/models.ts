import { anthropic } from '@ai-sdk/anthropic';
import type { AiModuleOptions } from '@nestjs/ai';
import { FakeModel } from '@nestjs/ai/testing';

/**
 * The store's models: Claude when ANTHROPIC_API_KEY is set; otherwise fake ones from `@nestjs/ai/testing`, so that
 * the sample runs offline. Prices are per million tokens, in US dollars.
 */
export function storeModels(): AiModuleOptions['models'] {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      default: { model: anthropic('claude-opus-5-5'), pricing: { input: 4, output: 20, cachedInput: 0.2 } },
      fast: { model: anthropic('claude-haiku-5-5'), pricing: { input: 0.1, output: 0.5 }, fallback: 'default' },
    };
  }
  return {
    // Looks the order up, then answers with what it found.
    default: new FakeModel((call) => {
      const order = call.toolResults[0]?.output as { id: string; status: string } | undefined;
      if (order) {
        return `Order ${order.id} is ${order.status}.`;
      }
      const orderId = /ord_\d+/.exec(call.lastUserMessage ?? '')?.[0];
      return orderId ? { toolCalls: [{ name: 'find-order', input: { orderId } }] } : 'Which order is it about?';
    }),
    fast: new FakeModel((call) =>
      call.options.responseFormat?.type === 'json'
        ? { object: { category: 'shipping', orderId: /ord_\d+/.exec(call.lastUserMessage ?? '')?.[0] ?? null, urgent: false } }
        : 'Thanks for writing in! Your order is on its way.',
    ),
  };
}
