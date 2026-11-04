import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AiService } from '@nestjs/ai';
import { convertToModelMessages, type UIMessage } from 'ai';
import { CustomerGuard } from './customer.guard.js';

@Controller('assistant')
@UseGuards(CustomerGuard)
export class AssistantController {
  constructor(private readonly ai: AiService) {}

  /** What the store's chat widget (`useChat()` from `@ai-sdk/react`) posts to, and reads the answer from. */
  @Post('chat')
  async chat(@Body() { messages }: { messages: UIMessage[] }, @Req() request: unknown, @Res() response: unknown) {
    const answer = this.ai.streamText({
      label: 'assistant',
      instructions: 'You help customers of the cat store with their orders. Look an order up before you answer about it.',
      messages: await convertToModelMessages(messages),
      tools: ['find-order', 'change-address'],
      caller: { request },
    });
    await answer.pipeUIMessageStreamToResponse(response);
  }
}
