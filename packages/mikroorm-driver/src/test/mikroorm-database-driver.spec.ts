import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MikroORM, Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { EventConfigurationResolverContract } from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { MikroORMDatabaseDriver } from '../driver/mikroorm.database-driver';
import { createTestDatabase, dropTestDatabase } from './test-utils';

@Entity({ tableName: 'test_entity' })
class TestEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

describe('MikroORMDatabaseDriver', () => {
  let orm: MikroORM;
  let dbName: string;

  const createEventConfigResolver = (maxRetries = 5): EventConfigurationResolverContract => ({
    resolve: () => ({
      name: 'TestEvent',
      listeners: {
        retentionPeriod: 60000,
        maxRetries,
        maxExecutionTime: 30000,
        retryStrategy: () => 10000,
      },
    }),
  });

  beforeAll(async () => {
    dbName = await createTestDatabase();
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      dbName,
      entities: [MikroOrmOutboxTransportEvent, TestEntity],
      allowGlobalContext: true,
    });
    await orm.getSchemaGenerator().createSchema();
  });

  afterAll(async () => {
    await orm.close();
    await dropTestDatabase(dbName);
  });

  beforeEach(async () => {
    await orm.em.nativeDelete(MikroOrmOutboxTransportEvent, {});
    await orm.em.nativeDelete(TestEntity, {});
    orm.em.clear();
  });

  describe('createOutboxTransportEvent', () => {
    it('should create a transport event', () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      expect(event).toBeInstanceOf(MikroOrmOutboxTransportEvent);
      expect(event.eventName).toBe('TestEvent');
      expect(event.eventPayload).toEqual({ data: 'test' });
    });
  });

  describe('persist', () => {
    it('should queue entity for persistence', async () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const freshEm = orm.em.fork();
      const retrieved = await freshEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'TestEvent' });
      expect(retrieved).toBeDefined();
    });

    it('should persist multiple entities', async () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const entity = new TestEntity();
      entity.name = 'Test';

      const event = driver.createOutboxTransportEvent(
        'TestEvent',
        {},
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(entity);
      await driver.persist(event);
      await driver.flush();

      const freshEm = orm.em.fork();
      const retrievedEntity = await freshEm.findOne(TestEntity, { name: 'Test' });
      const retrievedEvent = await freshEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'TestEvent' });

      expect(retrievedEntity).toBeDefined();
      expect(retrievedEvent).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should queue entity for removal', async () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'RemoveTest',
        {},
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const freshEm = orm.em.fork();
      const eventToRemove = await freshEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'RemoveTest' });
      expect(eventToRemove).toBeDefined();

      const removeDriver = new MikroORMDatabaseDriver(freshEm, createEventConfigResolver());
      await removeDriver.remove(eventToRemove!);
      await removeDriver.flush();

      const checkEm = orm.em.fork();
      const removed = await checkEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'RemoveTest' });
      expect(removed).toBeNull();
    });
  });

  describe('flush', () => {
    it('should persist all queued entities atomically', async () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const event1 = driver.createOutboxTransportEvent('Event1', {}, Date.now() + 60000, Date.now() + 5000);
      const event2 = driver.createOutboxTransportEvent('Event2', {}, Date.now() + 60000, Date.now() + 5000);

      await driver.persist(event1);
      await driver.persist(event2);

      const checkBeforeFlush = orm.em.fork();
      const beforeFlush = await checkBeforeFlush.find(MikroOrmOutboxTransportEvent, {});
      expect(beforeFlush).toHaveLength(0);

      await driver.flush();

      const checkAfterFlush = orm.em.fork();
      const afterFlush = await checkAfterFlush.find(MikroOrmOutboxTransportEvent, {});
      expect(afterFlush).toHaveLength(2);
    });

    it('should clear entity manager after flush', async () => {
      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent('ClearTest', {}, Date.now() + 60000, Date.now() + 5000);
      await driver.persist(event);
      await driver.flush();

      const managedEntities = em.getUnitOfWork().getIdentityMap().values();
      expect([...managedEntities]).toHaveLength(0);
    });
  });

  describe('findAndExtendReadyToRetryEvents', () => {
    it('should find events ready to retry', async () => {
      const setupEm = orm.em.fork();
      const now = Date.now();

      const readyEvent = new MikroOrmOutboxTransportEvent().create('ReadyEvent', {}, now + 60000, now - 1000);
      const notReadyEvent = new MikroOrmOutboxTransportEvent().create('NotReadyEvent', {}, now + 60000, now + 60000);

      setupEm.persist([readyEvent, notReadyEvent]);
      await setupEm.flush();

      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const { pendingEvents } = await driver.findAndExtendReadyToRetryEvents(10);

      expect(pendingEvents).toHaveLength(1);
      expect(pendingEvents[0].eventName).toBe('ReadyEvent');
    });

    it('should extend attemptAt timestamp and increment retryCount', async () => {
      const setupEm = orm.em.fork();
      const now = Date.now();
      const originalRetryAfter = now - 1000;

      const event = new MikroOrmOutboxTransportEvent().create('ExtendTest', {}, now + 60000, originalRetryAfter);
      setupEm.persist(event);
      await setupEm.flush();

      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const { pendingEvents } = await driver.findAndExtendReadyToRetryEvents(10);

      expect(pendingEvents).toHaveLength(1);
      expect(pendingEvents[0].attemptAt).toBeGreaterThan(now);
      expect(pendingEvents[0].retryCount).toBe(1);

      const checkEm = orm.em.fork();
      const persisted = await checkEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'ExtendTest' });
      expect(persisted!.attemptAt).toBeGreaterThan(now);
      expect(persisted!.retryCount).toBe(1);
    });

    it('should move event to failed status when max retries exceeded', async () => {
      const setupEm = orm.em.fork();
      const now = Date.now();

      const event = new MikroOrmOutboxTransportEvent().create('FailedTest', {}, now + 60000, now - 1000);
      event.retryCount = 5;
      setupEm.persist(event);
      await setupEm.flush();

      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver(5));

      const { pendingEvents, deadLetteredEvents } = await driver.findAndExtendReadyToRetryEvents(10);

      expect(pendingEvents).toHaveLength(0);
      expect(deadLetteredEvents).toHaveLength(1);
      expect(deadLetteredEvents[0].eventName).toBe('FailedTest');

      const checkEm = orm.em.fork();
      const persisted = await checkEm.findOne(MikroOrmOutboxTransportEvent, { eventName: 'FailedTest' });
      expect(persisted!.status).toBe('failed');
      expect(persisted!.attemptAt).toBeNull();
    });

    it('should respect limit parameter', async () => {
      const setupEm = orm.em.fork();
      const now = Date.now();

      const events = Array.from({ length: 5 }, (_, i) =>
        new MikroOrmOutboxTransportEvent().create(`Event${i}`, {}, now + 60000, now - 1000)
      );
      setupEm.persist(events);
      await setupEm.flush();

      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const { pendingEvents } = await driver.findAndExtendReadyToRetryEvents(3);

      expect(pendingEvents).toHaveLength(3);
    });

    it('should return empty array when no events are ready', async () => {
      const setupEm = orm.em.fork();
      const event = new MikroOrmOutboxTransportEvent().create('FutureEvent', {}, Date.now() + 60000, Date.now() + 60000);
      setupEm.persist(event);
      await setupEm.flush();

      const em = orm.em.fork();
      const driver = new MikroORMDatabaseDriver(em, createEventConfigResolver());

      const { pendingEvents, deadLetteredEvents } = await driver.findAndExtendReadyToRetryEvents(10);

      expect(pendingEvents).toHaveLength(0);
      expect(deadLetteredEvents).toHaveLength(0);
    });

    it('should use pessimistic locking for concurrent access', async () => {
      const setupEm = orm.em.fork();
      const now = Date.now();

      const events = Array.from({ length: 10 }, (_, i) =>
        new MikroOrmOutboxTransportEvent().create(`ConcurrentEvent${i}`, {}, now + 60000, now - 1000)
      );
      setupEm.persist(events);
      await setupEm.flush();

      const em1 = orm.em.fork();
      const em2 = orm.em.fork();
      const driver1 = new MikroORMDatabaseDriver(em1, createEventConfigResolver());
      const driver2 = new MikroORMDatabaseDriver(em2, createEventConfigResolver());

      const [result1, result2] = await Promise.all([
        driver1.findAndExtendReadyToRetryEvents(5),
        driver2.findAndExtendReadyToRetryEvents(5),
      ]);

      const allEventNames = [...result1.pendingEvents.map(e => e.eventName), ...result2.pendingEvents.map(e => e.eventName)];
      const uniqueEventNames = new Set(allEventNames);
      expect(uniqueEventNames.size).toBe(allEventNames.length);
    });
  });
});
