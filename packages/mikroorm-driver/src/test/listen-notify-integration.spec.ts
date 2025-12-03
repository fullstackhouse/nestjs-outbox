import 'reflect-metadata';
import { describe, it, expect, afterEach } from 'vitest';
import { Entity, PrimaryKey, Property, MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  TransactionalEventEmitter,
  TransactionalEventEmitterOperations,
  InboxOutboxEvent,
  IListener,
  InboxOutboxModule,
  EVENT_LISTENER_TOKEN,
  EventListener,
} from '@nestixis/nestjs-inbox-outbox';
import { MikroOrmInboxOutboxTransportEvent } from '../model/mikroorm-inbox-outbox-transport-event.model';
import { MikroORMDatabaseDriverFactory } from '../driver/mikroorm-database-driver.factory';
import { getNotifyTriggerSQL } from '../listener/postgresql-event-listener';
import {
  BASE_CONNECTION,
  createTestDatabase,
  dropTestDatabase,
} from './test-utils';
import { Client } from 'pg';

@Entity({ tableName: 'users' })
class User {
  @PrimaryKey()
  id: number;

  @Property()
  email: string;

  @Property()
  name: string;
}

class UserCreatedEvent extends InboxOutboxEvent {
  public readonly name = 'UserCreated';

  constructor(
    public readonly userId: number,
    public readonly email: string,
  ) {
    super();
  }
}

interface TestContext {
  app: INestApplication;
  orm: MikroORM;
  module: TestingModule;
  dbName: string;
  driverFactory: MikroORMDatabaseDriverFactory;
}

async function createTestAppWithNotify(): Promise<TestContext> {
  const dbName = await createTestDatabase();

  const orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    ...BASE_CONNECTION,
    dbName,
    entities: [MikroOrmInboxOutboxTransportEvent, User],
    allowGlobalContext: true,
  });
  await orm.getSchemaGenerator().createSchema();

  const driverFactory = new MikroORMDatabaseDriverFactory(orm);

  const testingModule = await Test.createTestingModule({
    imports: [
      InboxOutboxModule.registerAsync({
        useFactory: () => ({
          driverFactory,
          events: [
            {
              name: 'UserCreated',
              listeners: {
                expiresAtTTL: 60000,
                readyToRetryAfterTTL: 100,
                maxExecutionTimeTTL: 30000,
              },
            },
          ],
          retryEveryMilliseconds: 60000,
          maxInboxOutboxTransportEventPerRetry: 100,
        }),
        isGlobal: true,
      }),
    ],
    providers: [{ provide: MikroORM, useValue: orm }],
  }).compile();

  const app = testingModule.createNestApplication();
  await app.init();

  const triggerSQL = getNotifyTriggerSQL();
  const pgClient = new Client({
    ...BASE_CONNECTION,
    database: dbName,
  });
  await pgClient.connect();
  await pgClient.query(triggerSQL.createFunction);
  await pgClient.query(triggerSQL.createTrigger);
  await pgClient.end();

  const eventListener = driverFactory.getEventListener();
  await eventListener?.connect();

  return {
    app,
    orm,
    module: testingModule,
    dbName,
    driverFactory,
  };
}

async function cleanupTestAppWithNotify(context: TestContext): Promise<void> {
  const eventListener = context.driverFactory.getEventListener();
  await eventListener?.disconnect();
  await context.app.close();
  await context.orm.close();
  await dropTestDatabase(context.dbName);
}

describe('LISTEN/NOTIFY Integration Tests', () => {
  let context: TestContext;

  afterEach(async () => {
    if (context) {
      await cleanupTestAppWithNotify(context);
    }
  });

  it('should receive instant event when event is inserted', async () => {
    context = await createTestAppWithNotify();

    const emitter = context.module.get(TransactionalEventEmitter);
    const eventListener = context.module.get<EventListener>(EVENT_LISTENER_TOKEN);
    const orm = context.orm;

    let eventReceived = false;
    const eventPromise = new Promise<void>((resolve) => {
      const subscription = eventListener.events$.subscribe(() => {
        eventReceived = true;
        subscription.unsubscribe();
        resolve();
      });
    });

    const user = new User();
    user.email = 'notify@example.com';
    user.name = 'Notify User';

    const failingListener: IListener<UserCreatedEvent> = {
      getName: () => 'FailingListener',
      handle: async () => {
        throw new Error('Intentional failure to keep event in database');
      },
    };
    emitter.addListener('UserCreated', failingListener);

    const event = new UserCreatedEvent(1, 'notify@example.com');
    await emitter.emitAsync(event, [
      { operation: TransactionalEventEmitterOperations.persist, entity: user },
    ]);

    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout waiting for event')), 5000),
    );

    await Promise.race([eventPromise, timeoutPromise]);

    expect(eventReceived).toBe(true);

    const em = orm.em.fork();
    const transportEvents = await em.find(MikroOrmInboxOutboxTransportEvent, {
      eventName: 'UserCreated',
    });
    expect(transportEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('should process events via NOTIFY faster than polling interval', async () => {
    context = await createTestAppWithNotify();

    const emitter = context.module.get(TransactionalEventEmitter);
    const eventListener = context.module.get<EventListener>(EVENT_LISTENER_TOKEN);

    const eventTimings: number[] = [];
    const startTime = Date.now();

    const subscription = eventListener.events$.subscribe(() => {
      eventTimings.push(Date.now() - startTime);
    });

    const user = new User();
    user.email = 'fast@example.com';
    user.name = 'Fast User';

    const failingListener: IListener<UserCreatedEvent> = {
      getName: () => 'FailingListenerFast',
      handle: async () => {
        throw new Error('Intentional failure');
      },
    };
    emitter.addListener('UserCreated', failingListener);

    const event = new UserCreatedEvent(1, 'fast@example.com');
    await emitter.emitAsync(event, [
      { operation: TransactionalEventEmitterOperations.persist, entity: user },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 500));

    subscription.unsubscribe();

    expect(eventTimings.length).toBeGreaterThanOrEqual(1);
    expect(eventTimings[0]).toBeLessThan(1000);
  });

  it('should get event listener from factory via getEventListener()', async () => {
    context = await createTestAppWithNotify();

    const eventListener = context.driverFactory.getEventListener();

    expect(eventListener).not.toBeNull();
    expect(eventListener).toBe(context.module.get<EventListener>(EVENT_LISTENER_TOKEN));
  });
});
