import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentFunction } from '@nestjs/ai';
import { Tool } from '@nestjs/mcp';
import * as z from 'zod';
import { OrdersService } from './orders.service.js';

/** The arguments of find-order: one schema for both of its decorators. */
const FindOrderInput = z.object({ orderId: z.string().describe('The order id, such as ord_1') });

/**
 * Served to the support team's MCP clients by `@Tool()`, and to the store's own assistant by `@AgentFunction()`: one
 * method, with each decorator's own options.
 */
@Injectable()
export class OrdersTools {
  constructor(private readonly orders: OrdersService) {}

  @Tool({
    name: 'find-order',
    description: 'Find an order by its id, with its status',
    inputSchema: FindOrderInput,
    annotations: { readOnlyHint: true },
  })
  @AgentFunction({
    name: 'find-order',
    description: 'Find an order by its id, with its status',
    inputSchema: FindOrderInput,
  })
  find({ orderId }: { orderId: string }) {
    const order = this.orders.find(orderId);
    if (!order) {
      throw new NotFoundException(`There is no order ${orderId}`);
    }
    return { id: order.id, status: order.status };
  }
}
