import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, Like } from 'typeorm';
import { EventConfigurationResolverContract } from '@fullstackhouse/nestjs-outbox';
import { TypeOrmOutboxTransportEvent } from '../model/typeorm-outbox-transport-event.model';
import { TypeORMDatabaseDriverFactory } from '../driver/typeorm-database-driver.factory';
import { TypeORMDatabaseDriver } from '../driver/typeorm.database-driver';
import { createTestDatabase, dropTestDatabase, BASE_CONNECTION } from './test-utils';

describe('TypeORMDatabaseDriverFactory', () => {
  let dataSource: DataSource;
  let dbName: string;

  const createEventConfigResolver = (): EventConfigurationResolverContract => ({
    resolve: () => ({
      name: 'TestEvent',
      listeners: {
        retentionPeriod: 60000,
        maxRetries: 5,
        maxExecutionTime: 30000,
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
      entities: [TypeOrmOutboxTransportEvent],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await dropTestDatabase(dbName);
  });

  describe('create', () => {
    it('should create a TypeORMDatabaseDriver instance', () => {
      const factory = new TypeORMDatabaseDriverFactory(dataSource);
      const driver = factory.create(createEventConfigResolver());

      expect(driver).toBeInstanceOf(TypeORMDatabaseDriver);
    });

    it('should create multiple independent drivers', async () => {
      const factory = new TypeORMDatabaseDriverFactory(dataSource);

      const driver1 = factory.create(createEventConfigResolver());
      const driver2 = factory.create(createEventConfigResolver());

      const event1 = driver1.createOutboxTransportEvent('Event1', {}, Date.now() + 60000, Date.now() + 5000);
      const event2 = driver2.createOutboxTransportEvent('Event2', {}, Date.now() + 60000, Date.now() + 5000);

      await driver1.persist(event1);
      await driver2.persist(event2);

      await driver1.flush();
      await driver2.flush();

      const events = await dataSource.getRepository(TypeOrmOutboxTransportEvent).find();
      expect(events).toHaveLength(2);
    });

    it('should create isolated drivers that do not share state', async () => {
      const factory = new TypeORMDatabaseDriverFactory(dataSource);

      const driver1 = factory.create(createEventConfigResolver());
      const driver2 = factory.create(createEventConfigResolver());

      const event = driver1.createOutboxTransportEvent('IsolationTest', {}, Date.now() + 60000, Date.now() + 5000);
      await driver1.persist(event);

      await driver2.flush();

      const events = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findBy({ eventName: 'IsolationTest' });
      expect(events).toHaveLength(0);

      await driver1.flush();

      const eventsAfter = await dataSource.getRepository(TypeOrmOutboxTransportEvent).findBy({ eventName: 'IsolationTest' });
      expect(eventsAfter).toHaveLength(1);
    });

    it('should allow concurrent operations without interference', async () => {
      const factory = new TypeORMDatabaseDriverFactory(dataSource);

      const operations = Array.from({ length: 5 }, async (_, i) => {
        const driver = factory.create(createEventConfigResolver());
        const event = driver.createOutboxTransportEvent(`ConcurrentEvent${i}`, { index: i }, Date.now() + 60000, Date.now() + 5000);
        await driver.persist(event);
        await driver.flush();
        return event;
      });

      await Promise.all(operations);

      const events = await dataSource.getRepository(TypeOrmOutboxTransportEvent).find({
        where: { eventName: Like('ConcurrentEvent%') },
      });

      expect(events).toHaveLength(5);
      const indices = events.map(e => e.eventPayload.index).sort();
      expect(indices).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
