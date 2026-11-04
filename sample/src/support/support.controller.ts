import { Body, Controller, Post } from '@nestjs/common';
import { TriageService } from './triage.service.js';

@Controller('support')
export class SupportController {
  constructor(private readonly triage: TriageService) {}

  @Post('emails')
  receive(@Body() { text }: { text: string }) {
    return this.triage.triage(text);
  }
}
