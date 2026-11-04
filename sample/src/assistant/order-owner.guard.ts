import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AiExecutionContext, type AiContextType } from '@nestjs/ai';
import { OrdersService } from '../orders/orders.service.js';

/** Lets the assistant change an order only for the customer who placed it, signed in on the chat's request. */
@Injectable()
export class OrderOwnerGuard implements CanActivate {
  constructor(private readonly orders: OrdersService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<AiContextType>() !== 'ai') {
      return false;
    }
    const call = AiExecutionContext.create(context);
    const order = this.orders.find(call.getInput<{ orderId: string }>().orderId);
    const customer = call.getRequest<{ user?: { name: string } }>()?.user;
    return order !== undefined && order.customer === customer?.name;
  }
}
