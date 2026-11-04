import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { TriageService } from './triage.service.js';

@Module({
  controllers: [SupportController],
  providers: [TriageService],
})
export class SupportModule {}
