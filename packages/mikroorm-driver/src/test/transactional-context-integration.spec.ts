import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, PrimaryKey, Property, MikroORM, Transactional, EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import {
  TransactionalEventEmitter,
  OutboxEvent,
  IListener,
} from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { createTestApp, cleanupTestApp, TestContext } from './test-utils';

@Entity({ tableName: 'orders' })
class Order {
  @PrimaryKey()
  id: number;

  @Property()
  customerEmail: string;

  @Property()
  total: number;
}

class OrderCreatedEvent extends OutboxEvent {
  public readonly name = 'OrderCreated';

  constructor(
    public readonly orderId: number,
    public readonly customerEmail: string,
  ) {
    super();
  }
}

@Injectable()
class OrderService {
  constructor(
    private em: EntityManager,
    private emitter: TransactionalEventEmitter,
  ) {}

  @Transactional()
  async createOrder(customerEmail: string, total: number): Promise<Order> {
    const order = new Order();
    order.customerEmail = customerEmail;
    order.total = total;
    this.em.persist(order);

    await this.emitter.emitAsync(new OrderCreatedEvent(order.id, customerEmail));

    return order;
  }

  @Transactional()
  async createOrderWithRollback(customerEmail: string, total: number): Promise<Order> {
    const order = new Order();
    order.customerEmail = customerEmail;
    order.total = total;
    this.em.persist(order);

    await this.emitter.emitAsync(new OrderCreatedEvent(order.id, customerEmail));

    throw new Error('Intentional rollback');
  }
}

describe('@Transactional() decorator integration', () => {
  let context: TestContext;

  const defaultEvents = [
    {
      name: 'OrderCreated',
      listeners: {
        expiresAtTTL: 60000,
        readyToRetryAfterTTL: 5000,
        maxExecutionTimeTTL: 30000,
      },
    },
  ];

  afterEach(async () => {
    if (context) {
      await cleanupTestApp(context);
    }
  });

  describe('with useContext: true', () => {
    beforeEach(async () => {
      context = await createTestApp({
        events: defaultEvents,
        additionalEntities: [Order],
        useContext: true,
      });
    });

    it('should persist entity and event in the same transaction', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const handledEvents: OrderCreatedEvent[] = [];
      const listener: IListener<OrderCreatedEvent> = {
        getName: () => 'TransactionalTestListener',
        handle: async (event: OrderCreatedEvent) => {
          handledEvents.push(event);
        },
      };
      emitter.addListener('OrderCreated', listener);

      const em = orm.em.fork({ useContext: true });
      const order = new Order();
      order.customerEmail = 'transactional@example.com';
      order.total = 100;

      await em.transactional(async () => {
        em.persist(order);
        await emitter.emitAsync(new OrderCreatedEvent(order.id, order.customerEmail));
      });

      const checkEm = orm.em.fork();
      const orders = await checkEm.find(Order, {});
      expect(orders).toHaveLength(1);
      expect(orders[0].customerEmail).toBe('transactional@example.com');

      expect(handledEvents).toHaveLength(1);
      expect(handledEvents[0].customerEmail).toBe('transactional@example.com');
    });

    it('should rollback both entity and event on transaction failure', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const handledEvents: OrderCreatedEvent[] = [];
      const listener: IListener<OrderCreatedEvent> = {
        getName: () => 'RollbackTestListener',
        handle: async (event: OrderCreatedEvent) => {
          handledEvents.push(event);
        },
      };
      emitter.addListener('OrderCreated', listener);

      const em = orm.em.fork({ useContext: true });

      await expect(
        em.transactional(async () => {
          const order = new Order();
          order.customerEmail = 'rollback@example.com';
          order.total = 200;
          em.persist(order);

          await emitter.emitAsync(new OrderCreatedEvent(order.id, order.customerEmail));

          throw new Error('Intentional rollback');
        }),
      ).rejects.toThrow('Intentional rollback');

      const checkEm = orm.em.fork();
      const orders = await checkEm.find(Order, { customerEmail: 'rollback@example.com' });
      expect(orders).toHaveLength(0);

      const transportEvents = await checkEm.find(MikroOrmOutboxTransportEvent, {});
      expect(transportEvents).toHaveLength(0);
    });

    it('should work with nested @Transactional calls', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const handledEvents: OrderCreatedEvent[] = [];
      const listener: IListener<OrderCreatedEvent> = {
        getName: () => 'NestedTransactionalListener',
        handle: async (event: OrderCreatedEvent) => {
          handledEvents.push(event);
        },
      };
      emitter.addListener('OrderCreated', listener);

      const em = orm.em.fork({ useContext: true });

      await em.transactional(async () => {
        const order1 = new Order();
        order1.customerEmail = 'nested1@example.com';
        order1.total = 100;
        em.persist(order1);

        await em.transactional(async () => {
          const order2 = new Order();
          order2.customerEmail = 'nested2@example.com';
          order2.total = 200;
          em.persist(order2);

          await emitter.emitAsync(new OrderCreatedEvent(order2.id, order2.customerEmail));
        });

        await emitter.emitAsync(new OrderCreatedEvent(order1.id, order1.customerEmail));
      });

      const checkEm = orm.em.fork();
      const orders = await checkEm.find(Order, {});
      expect(orders).toHaveLength(2);

      expect(handledEvents).toHaveLength(2);
    });

    it('should preserve identity map when using context', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const listener: IListener<OrderCreatedEvent> = {
        getName: () => 'IdentityMapListener',
        handle: async () => {},
      };
      emitter.addListener('OrderCreated', listener);

      const em = orm.em.fork({ useContext: true });
      let orderRef: Order | null = null;

      await em.transactional(async () => {
        const order = new Order();
        order.customerEmail = 'identity@example.com';
        order.total = 300;
        em.persist(order);
        orderRef = order;

        await emitter.emitAsync(new OrderCreatedEvent(order.id, order.customerEmail));

        const found = await em.findOne(Order, { customerEmail: 'identity@example.com' });
        expect(found).toBe(order);
      });

      expect(orderRef).not.toBeNull();
    });
  });

  describe('with useContext: false (default)', () => {
    beforeEach(async () => {
      context = await createTestApp({
        events: defaultEvents,
        additionalEntities: [Order],
        useContext: false,
      });
    });

    it('should rollback event when user transaction rolls back (default fork behavior)', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const listener: IListener<OrderCreatedEvent> = {
        getName: () => 'IsolatedListener',
        handle: async () => {},
      };
      emitter.addListener('OrderCreated', listener);

      const em = orm.em.fork();

      await expect(
        em.transactional(async () => {
          const order = new Order();
          order.customerEmail = 'isolated@example.com';
          order.total = 400;
          em.persist(order);

          await emitter.emitAsync(new OrderCreatedEvent(order.id, order.customerEmail));

          throw new Error('Intentional rollback');
        }),
      ).rejects.toThrow('Intentional rollback');

      const checkEm = orm.em.fork();
      const orders = await checkEm.find(Order, { customerEmail: 'isolated@example.com' });
      expect(orders).toHaveLength(0);

      const transportEvents = await checkEm.find(MikroOrmOutboxTransportEvent, {});
      expect(transportEvents).toHaveLength(0);
    });
  });
});
