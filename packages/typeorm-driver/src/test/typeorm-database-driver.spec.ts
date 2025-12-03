import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { EventConfigurationResolverContract } from '@nestixis/nestjs-inbox-outbox';
import { TypeOrmInboxOutboxTransportEvent } from '../model/typeorm-inbox-outbox-transport-event.model';
import { TypeORMDatabaseDriver } from '../driver/typeorm.database-driver';
import { createTestDatabase, dropTestDatabase, BASE_CONNECTION } from './test-utils';

@Entity({ name: 'test_entity' })
class TestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
}

describe('TypeORMDatabaseDriver', () => {
  let dataSource: DataSource;
  let dbName: string;

  const createEventConfigResolver = (readyToRetryAfterTTL = 5000): EventConfigurationResolverContract => ({
    resolve: () => ({
      name: 'TestEvent',
      listeners: {
        expiresAtTTL: 60000,
        readyToRetryAfterTTL,
        maxExecutionTimeTTL: 30000,
      },
    }),
  });

  beforeAll(async () => {
    dbName = await createTestDatabase();
    dataSource = new DataSource({
      type: 'postgres',
      host: BASE_CONNECTION.host,
      port: BASE_CONNECTION.port,
      username: BASE_CONNECTION.user,
      password: BASE_CONNECTION.password,
      database: dbName,
      entities: [TypeOrmInboxOutboxTransportEvent, TestEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await dropTestDatabase(dbName);
  });

  beforeEach(async () => {
    await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).clear();
    await dataSource.getRepository(TestEntity).clear();
  });

  describe('createInboxOutboxTransportEvent', () => {
    it('should create a transport event', () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createInboxOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      expect(event).toBeInstanceOf(TypeOrmInboxOutboxTransportEvent);
      expect(event.eventName).toBe('TestEvent');
      expect(event.eventPayload).toEqual({ data: 'test' });
    });
  });

  describe('persist', () => {
    it('should queue entity for persistence', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createInboxOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const retrieved = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).findOneBy({ eventName: 'TestEvent' });
      expect(retrieved).toBeDefined();
    });

    it('should persist multiple entities', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const entity = new TestEntity();
      entity.name = 'Test';

      const event = driver.createInboxOutboxTransportEvent(
        'TestEvent',
        {},
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(entity);
      await driver.persist(event);
      await driver.flush();

      const retrievedEntity = await dataSource.getRepository(TestEntity).findOneBy({ name: 'Test' });
      const retrievedEvent = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).findOneBy({ eventName: 'TestEvent' });

      expect(retrievedEntity).toBeDefined();
      expect(retrievedEvent).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should queue entity for removal', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createInboxOutboxTransportEvent(
        'RemoveTest',
        {},
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const eventToRemove = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).findOneBy({ eventName: 'RemoveTest' });
      expect(eventToRemove).toBeDefined();

      const removeDriver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());
      await removeDriver.remove(eventToRemove!);
      await removeDriver.flush();

      const removed = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).findOneBy({ eventName: 'RemoveTest' });
      expect(removed).toBeNull();
    });
  });

  describe('flush', () => {
    it('should persist all queued entities atomically', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event1 = driver.createInboxOutboxTransportEvent('Event1', {}, Date.now() + 60000, Date.now() + 5000);
      const event2 = driver.createInboxOutboxTransportEvent('Event2', {}, Date.now() + 60000, Date.now() + 5000);

      await driver.persist(event1);
      await driver.persist(event2);

      const beforeFlush = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).find();
      expect(beforeFlush).toHaveLength(0);

      await driver.flush();

      const afterFlush = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).find();
      expect(afterFlush).toHaveLength(2);
    });

    it('should clear queued entities after flush', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createInboxOutboxTransportEvent('ClearTest', {}, Date.now() + 60000, Date.now() + 5000);
      await driver.persist(event);
      await driver.flush();

      await driver.flush();

      const events = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).find();
      expect(events).toHaveLength(1);
    });
  });

  describe('findAndExtendReadyToRetryEvents', () => {
    it('should find events ready to retry', async () => {
      const now = Date.now();

      const readyEvent = new TypeOrmInboxOutboxTransportEvent().create('ReadyEvent', {}, now + 60000, now - 1000);
      const notReadyEvent = new TypeOrmInboxOutboxTransportEvent().create('NotReadyEvent', {}, now + 60000, now + 60000);

      await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).save([readyEvent, notReadyEvent]);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver(10000));

      const events = await driver.findAndExtendReadyToRetryEvents(10);

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('ReadyEvent');
    });

    it('should extend readyToRetryAfter timestamp', async () => {
      const now = Date.now();
      const originalRetryAfter = now - 1000;

      const event = new TypeOrmInboxOutboxTransportEvent().create('ExtendTest', {}, now + 60000, originalRetryAfter);
      await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).save(event);

      const ttl = 10000;
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver(ttl));

      const events = await driver.findAndExtendReadyToRetryEvents(10);

      expect(events).toHaveLength(1);
      expect(events[0].readyToRetryAfter).toBeGreaterThan(now);

      const persisted = await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).findOneBy({ eventName: 'ExtendTest' });
      expect(Number(persisted!.readyToRetryAfter)).toBeGreaterThan(now);
    });

    it('should respect limit parameter', async () => {
      const now = Date.now();

      const events = Array.from({ length: 5 }, (_, i) =>
        new TypeOrmInboxOutboxTransportEvent().create(`Event${i}`, {}, now + 60000, now - 1000)
      );
      await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).save(events);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const result = await driver.findAndExtendReadyToRetryEvents(3);

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no events are ready', async () => {
      const event = new TypeOrmInboxOutboxTransportEvent().create('FutureEvent', {}, Date.now() + 60000, Date.now() + 60000);
      await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).save(event);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const result = await driver.findAndExtendReadyToRetryEvents(10);

      expect(result).toHaveLength(0);
    });

    it('should use pessimistic locking for concurrent access', async () => {
      const now = Date.now();

      const events = Array.from({ length: 10 }, (_, i) =>
        new TypeOrmInboxOutboxTransportEvent().create(`ConcurrentEvent${i}`, {}, now + 60000, now - 1000)
      );
      await dataSource.getRepository(TypeOrmInboxOutboxTransportEvent).save(events);

      const driver1 = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());
      const driver2 = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const [result1, result2] = await Promise.all([
        driver1.findAndExtendReadyToRetryEvents(5),
        driver2.findAndExtendReadyToRetryEvents(5),
      ]);

      const allEventNames = [...result1.map(e => e.eventName), ...result2.map(e => e.eventName)];
      const uniqueEventNames = new Set(allEventNames);
      expect(uniqueEventNames.size).toBe(allEventNames.length);
    });
  });
});
