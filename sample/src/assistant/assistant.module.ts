import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantTools } from './assistant.tools.js';
import { OrderOwnerGuard } from './order-owner.guard.js';

@Module({
  imports: [OrdersModule],
  controllers: [AssistantController],
  providers: [AssistantTools, OrderOwnerGuard],
})
export class AssistantModule {}
