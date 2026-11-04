import { Injectable, NotFoundException } from '@nestjs/common';

export interface Order {
  id: string;
  customer: string;
  status: 'packing' | 'shipped' | 'delivered';
  address: string;
}

@Injectable()
export class OrdersService {
  private readonly orders = new Map<string, Order>([
    ['ord_1', { id: 'ord_1', customer: 'alice', status: 'shipped', address: '1 Cat Street, Catford' }],
    ['ord_2', { id: 'ord_2', customer: 'bob', status: 'packing', address: '2 Whisker Lane, Mousehole' }],
  ]);

  find(id: string): Order | undefined {
    return this.orders.get(id);
  }

  changeAddress(id: string, address: string): Order {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`There is no order ${id}`);
    }
    order.address = address;
    return order;
  }
}
