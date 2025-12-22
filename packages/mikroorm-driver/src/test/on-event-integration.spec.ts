import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Injectable, Module } from '@nestjs/common';
import {
  TransactionalEventEmitter,
  TransactionalEventEmitterOperations,
  OutboxEvent,
  OnEvent,
} from '@fullstackhouse/nestjs-outbox';
import { createTestApp, cleanupTestApp, TestContext } from './test-utils';

@Entity({ tableName: 'users' })
class User {
  @PrimaryKey()
  id: number;

  @Property()
  email: string;

  @Property()
  name: string;
}

class UserCreatedEvent extends OutboxEvent {
  public readonly name = 'UserCreated';

  constructor(
    public readonly userId: number,
    public readonly email: string,
  ) {
    super();
  }
}

class UserDeletedEvent extends OutboxEvent {
  public readonly name = 'UserDeleted';

  constructor(public readonly userId: number) {
    super();
  }
}

class UserUpdatedEvent extends OutboxEvent {
  public readonly name = 'UserUpdated';

  constructor(
    public readonly userId: number,
    public readonly newEmail: string,
  ) {
    super();
  }
}

const handledEvents: { type: string; event: any }[] = [];

@Injectable()
class MultiEventListener {
  @OnEvent('UserCreated')
  async handleUserCreated(event: UserCreatedEvent) {
    handledEvents.push({ type: 'created', event });
  }

  @OnEvent('UserDeleted')
  async handleUserDeleted(event: UserDeletedEvent) {
    handledEvents.push({ type: 'deleted', event });
  }

  @OnEvent('UserUpdated')
  async handleUserUpdated(event: UserUpdatedEvent) {
    handledEvents.push({ type: 'updated', event });
  }
}

@Module({
  providers: [MultiEventListener],
})
class ListenerModule {}

describe('@OnEvent Integration Tests', () => {
  let context: TestContext;

  const defaultEvents = [
    {
      name: 'UserCreated',
      listeners: {
        expiresAtTTL: 60000,
        readyToRetryAfterTTL: 5000,
        maxExecutionTimeTTL: 30000,
      },
    },
    {
      name: 'UserDeleted',
      listeners: {
        expiresAtTTL: 60000,
        readyToRetryAfterTTL: 5000,
        maxExecutionTimeTTL: 30000,
      },
    },
    {
      name: 'UserUpdated',
      listeners: {
        expiresAtTTL: 60000,
        readyToRetryAfterTTL: 5000,
        maxExecutionTimeTTL: 30000,
      },
    },
  ];

  beforeEach(async () => {
    handledEvents.length = 0;
    context = await createTestApp({
      events: defaultEvents,
      additionalEntities: [User],
      additionalModules: [ListenerModule],
    });
  });

  afterEach(async () => {
    if (context) {
      await cleanupTestApp(context);
    }
  });

  describe('Method-level @OnEvent listeners', () => {
    it('should invoke @OnEvent decorated method when event is emitted', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);

      const user = new User();
      user.email = 'test@example.com';
      user.name = 'Test User';

      const event = new UserCreatedEvent(1, 'test@example.com');

      await emitter.emitAsync(event, [
        { operation: TransactionalEventEmitterOperations.persist, entity: user },
      ]);

      expect(handledEvents).toHaveLength(1);
      expect(handledEvents[0].type).toBe('created');
      expect(handledEvents[0].event).toMatchObject({
        name: 'UserCreated',
        userId: 1,
        email: 'test@example.com',
      });
    });

    it('should route different events to different methods in the same class', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const user = new User();
      user.email = 'multi@example.com';
      user.name = 'Multi Event User';

      const createEvent = new UserCreatedEvent(1, 'multi@example.com');
      await emitter.emitAsync(createEvent, [
        { operation: TransactionalEventEmitterOperations.persist, entity: user },
      ]);

      const updateEvent = new UserUpdatedEvent(1, 'updated@example.com');
      await emitter.emitAsync(updateEvent, []);

      const em = orm.em.fork();
      const userToDelete = await em.findOne(User, { id: user.id });

      const deleteEvent = new UserDeletedEvent(1);
      await emitter.emitAsync(deleteEvent, [
        { operation: TransactionalEventEmitterOperations.remove, entity: userToDelete! },
      ]);

      expect(handledEvents).toHaveLength(3);
      expect(handledEvents[0].type).toBe('created');
      expect(handledEvents[1].type).toBe('updated');
      expect(handledEvents[2].type).toBe('deleted');
    });

    it('should receive correct event payload in handler method', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);

      const user = new User();
      user.email = 'payload@example.com';
      user.name = 'Payload User';

      const event = new UserCreatedEvent(42, 'payload@example.com');

      await emitter.emitAsync(event, [
        { operation: TransactionalEventEmitterOperations.persist, entity: user },
      ]);

      expect(handledEvents).toHaveLength(1);
      expect(handledEvents[0].event.userId).toBe(42);
      expect(handledEvents[0].event.email).toBe('payload@example.com');
    });

    it('should work with fire-and-forget emit', async () => {
      const emitter = context.module.get(TransactionalEventEmitter);

      const user = new User();
      user.email = 'async@example.com';
      user.name = 'Async User';

      const event = new UserCreatedEvent(1, 'async@example.com');

      await emitter.emit(event, [
        { operation: TransactionalEventEmitterOperations.persist, entity: user },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handledEvents).toHaveLength(1);
      expect(handledEvents[0].type).toBe('created');
    });
  });
});
