import { Injectable } from '@nestjs/common';
import { AiService } from '@nestjs/ai';
import * as z from 'zod';

export const Triage = z.object({
  category: z.enum(['shipping', 'billing', 'product', 'other']).describe('What the email is about'),
  orderId: z.string().nullable().describe('The order id it mentions, such as ord_1, or null'),
  urgent: z.boolean().describe('Whether the customer needs an answer today'),
});

@Injectable()
export class TriageService {
  constructor(private readonly ai: AiService) {}

  /** Classifies a support email, and drafts a reply for the support team to review. */
  async triage(email: string) {
    const { object: triage } = await this.ai.generateObject({
      model: 'fast',
      label: 'triage',
      schema: Triage,
      instructions: 'You sort the support email of a store for cat food and supplies.',
      prompt: email,
      budget: { maxTokens: 20_000 },
    });
    const { text: draft } = await this.ai.generateText({
      model: 'fast',
      label: 'draft-reply',
      instructions: 'Draft a short, friendly reply to the customer. Sign it "The Cat Store".',
      prompt: email,
      maxOutputTokens: 400,
    });
    return { ...triage, draft };
  }
}
