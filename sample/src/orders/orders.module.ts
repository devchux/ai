import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersTools } from './orders.tools.js';

@Module({
  providers: [OrdersService, OrdersTools],
  exports: [OrdersService],
})
export class OrdersModule {}
