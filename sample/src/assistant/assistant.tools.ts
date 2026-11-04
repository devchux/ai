import { Injectable, UseGuards } from '@nestjs/common';
import { AgentFunction } from '@nestjs/ai';
import * as z from 'zod';
import { OrdersService } from '../orders/orders.service.js';
import { OrderOwnerGuard } from './order-owner.guard.js';

/**
 * The assistant's own agent functions: customers change their own orders. They have no `@Tool()`, so MCP clients never
 * get them.
 */
@Injectable()
export class AssistantTools {
  constructor(private readonly orders: OrdersService) {}

  @AgentFunction({
    name: 'change-address',
    description: 'Change the delivery address of an order that has not shipped yet',
    inputSchema: z.object({ orderId: z.string(), address: z.string().min(10) }),
  })
  @UseGuards(OrderOwnerGuard)
  changeAddress({ orderId, address }: { orderId: string; address: string }) {
    const order = this.orders.changeAddress(orderId, address);
    return { id: order.id, address: order.address };
  }
}
