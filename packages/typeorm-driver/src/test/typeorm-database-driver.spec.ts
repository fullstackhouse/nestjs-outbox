import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { EventConfigurationResolverContract } from '@fullstackhouse/nestjs-outbox';
import { TypeOrmOutboxTransportEvent } from '../model/typeorm-outbox-transport-event.model';
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
    dataSource = new DataSource({
      type: 'postgres',
      host: BASE_CONNECTION.host,
      port: BASE_CONNECTION.port,
      username: BASE_CONNECTION.user,
      password: BASE_CONNECTION.password,
      database: dbName,
      entities: [TypeOrmOutboxTransportEvent, TestEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await dropTestDatabase(dbName);
  });

  beforeEach(async () => {
    await dataSource.getRepository(TypeOrmOutboxTransportEvent).clear();
    await dataSource.getRepository(TestEntity).clear();
  });

  describe('createOutboxTransportEvent', () => {
    it('should create a transport event', () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      expect(event).toBeInstanceOf(TypeOrmOutboxTransportEvent);
      expect(event.eventName).toBe('TestEvent');
      expect(event.eventPayload).toEqual({ data: 'test' });
    });
  });

  describe('persist', () => {
    it('should queue entity for persistence', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'TestEvent',
        { data: 'test' },
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const retrieved = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'TestEvent' });
      expect(retrieved).toBeDefined();
    });

    it('should persist multiple entities', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

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

      const retrievedEntity = await dataSource.getRepository(TestEntity).findOneBy({ name: 'Test' });
      const retrievedEvent = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'TestEvent' });

      expect(retrievedEntity).toBeDefined();
      expect(retrievedEvent).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should queue entity for removal', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent(
        'RemoveTest',
        {},
        Date.now() + 60000,
        Date.now() + 5000,
      );

      await driver.persist(event);
      await driver.flush();

      const eventToRemove = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'RemoveTest' });
      expect(eventToRemove).toBeDefined();

      const removeDriver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());
      await removeDriver.remove(eventToRemove!);
      await removeDriver.flush();

      const removed = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'RemoveTest' });
      expect(removed).toBeNull();
    });
  });

  describe('flush', () => {
    it('should persist all queued entities atomically', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event1 = driver.createOutboxTransportEvent('Event1', {}, Date.now() + 60000, Date.now() + 5000);
      const event2 = driver.createOutboxTransportEvent('Event2', {}, Date.now() + 60000, Date.now() + 5000);

      await driver.persist(event1);
      await driver.persist(event2);

      const beforeFlush = await dataSource.getRepository(TypeOrmOutboxTransportEvent).find();
      expect(beforeFlush).toHaveLength(0);

      await driver.flush();

      const afterFlush = await dataSource.getRepository(TypeOrmOutboxTransportEvent).find();
      expect(afterFlush).toHaveLength(2);
    });

    it('should clear queued entities after flush', async () => {
      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const event = driver.createOutboxTransportEvent('ClearTest', {}, Date.now() + 60000, Date.now() + 5000);
      await driver.persist(event);
      await driver.flush();

      await driver.flush();

      const events = await dataSource.getRepository(TypeOrmOutboxTransportEvent).find();
      expect(events).toHaveLength(1);
    });
  });

  describe('findAndExtendReadyToRetryEvents', () => {
    it('should find events ready to retry', async () => {
      const now = Date.now();

      const readyEvent = new TypeOrmOutboxTransportEvent().create('ReadyEvent', {}, now + 60000, now - 1000);
      const notReadyEvent = new TypeOrmOutboxTransportEvent().create('NotReadyEvent', {}, now + 60000, now + 60000);

      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save([readyEvent, notReadyEvent]);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const events = await driver.findAndExtendReadyToRetryEvents(10);

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('ReadyEvent');
    });

    it('should extend attemptAt timestamp and increment retryCount', async () => {
      const now = Date.now();
      const originalRetryAfter = now - 1000;

      const event = new TypeOrmOutboxTransportEvent().create('ExtendTest', {}, now + 60000, originalRetryAfter);
      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save(event);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const events = await driver.findAndExtendReadyToRetryEvents(10);

      expect(events).toHaveLength(1);
      expect(events[0].attemptAt).toBeGreaterThan(now);
      expect(events[0].retryCount).toBe(1);

      const persisted = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'ExtendTest' });
      expect(Number(persisted!.attemptAt)).toBeGreaterThan(now);
      expect(persisted!.retryCount).toBe(1);
    });

    it('should move event to failed status when max retries exceeded', async () => {
      const now = Date.now();

      const event = new TypeOrmOutboxTransportEvent().create('FailedTest', {}, now + 60000, now - 1000);
      event.retryCount = 4;
      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save(event);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver(5));

      const events = await driver.findAndExtendReadyToRetryEvents(10);

      expect(events).toHaveLength(0);

      const persisted = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findOneBy({ eventName: 'FailedTest' });
      expect(persisted!.status).toBe('failed');
      expect(persisted!.attemptAt).toBeNull();
    });

    it('should respect limit parameter', async () => {
      const now = Date.now();

      const events = Array.from({ length: 5 }, (_, i) =>
        new TypeOrmOutboxTransportEvent().create(`Event${i}`, {}, now + 60000, now - 1000)
      );
      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save(events);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const result = await driver.findAndExtendReadyToRetryEvents(3);

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no events are ready', async () => {
      const event = new TypeOrmOutboxTransportEvent().create('FutureEvent', {}, Date.now() + 60000, Date.now() + 60000);
      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save(event);

      const driver = new TypeORMDatabaseDriver(dataSource, createEventConfigResolver());

      const result = await driver.findAndExtendReadyToRetryEvents(10);

      expect(result).toHaveLength(0);
    });

    it('should use pessimistic locking for concurrent access', async () => {
      const now = Date.now();

      const events = Array.from({ length: 10 }, (_, i) =>
        new TypeOrmOutboxTransportEvent().create(`ConcurrentEvent${i}`, {}, now + 60000, now - 1000)
      );
      await dataSource.getRepository(TypeOrmOutboxTransportEvent).save(events);

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
