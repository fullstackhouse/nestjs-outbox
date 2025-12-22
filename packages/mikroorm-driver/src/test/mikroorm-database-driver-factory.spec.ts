import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MySqlDriver } from '@mikro-orm/mysql';
import { EventConfigurationResolverContract } from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { MikroORMDatabaseDriverFactory } from '../driver/mikroorm-database-driver.factory';
import { MikroORMDatabaseDriver } from '../driver/mikroorm.database-driver';
import { PostgreSQLEventListener } from '../listener/postgresql-event-listener';
import { createTestDatabase, dropTestDatabase, MYSQL_CONNECTION } from './test-utils';

describe('MikroORMDatabaseDriverFactory', () => {
  let orm: MikroORM;
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
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      dbName,
      entities: [MikroOrmOutboxTransportEvent],
      allowGlobalContext: true,
    });
    await orm.getSchemaGenerator().createSchema();
  });

  afterAll(async () => {
    await orm.close();
    await dropTestDatabase(dbName);
  });

  describe('create', () => {
    it('should create a MikroORMDatabaseDriver instance', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);
      const driver = factory.create(createEventConfigResolver());

      expect(driver).toBeInstanceOf(MikroORMDatabaseDriver);
    });

    it('should create drivers with forked entity managers', async () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);

      const driver1 = factory.create(createEventConfigResolver());
      const driver2 = factory.create(createEventConfigResolver());

      const event1 = driver1.createOutboxTransportEvent('Event1', {}, Date.now() + 60000, Date.now() + 5000);
      const event2 = driver2.createOutboxTransportEvent('Event2', {}, Date.now() + 60000, Date.now() + 5000);

      await driver1.persist(event1);
      await driver2.persist(event2);

      await driver1.flush();
      await driver2.flush();

      const checkEm = orm.em.fork();
      const events = await checkEm.find(MikroOrmOutboxTransportEvent, {});
      expect(events).toHaveLength(2);
    });

    it('should create isolated drivers that do not share state', async () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);

      const driver1 = factory.create(createEventConfigResolver());
      const driver2 = factory.create(createEventConfigResolver());

      const event = driver1.createOutboxTransportEvent('IsolationTest', {}, Date.now() + 60000, Date.now() + 5000);
      await driver1.persist(event);

      await driver2.flush();

      const checkEm = orm.em.fork();
      const events = await checkEm.find(MikroOrmOutboxTransportEvent, { eventName: 'IsolationTest' });
      expect(events).toHaveLength(0);

      await driver1.flush();

      const checkEm2 = orm.em.fork();
      const eventsAfter = await checkEm2.find(MikroOrmOutboxTransportEvent, { eventName: 'IsolationTest' });
      expect(eventsAfter).toHaveLength(1);
    });

    it('should allow concurrent operations without interference', async () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);

      const operations = Array.from({ length: 5 }, async (_, i) => {
        const driver = factory.create(createEventConfigResolver());
        const event = driver.createOutboxTransportEvent(`ConcurrentEvent${i}`, { index: i }, Date.now() + 60000, Date.now() + 5000);
        await driver.persist(event);
        await driver.flush();
        return event;
      });

      await Promise.all(operations);

      const checkEm = orm.em.fork();
      const events = await checkEm.find(MikroOrmOutboxTransportEvent, {
        eventName: { $like: 'ConcurrentEvent%' },
      });

      expect(events).toHaveLength(5);
      const indices = events.map(e => e.eventPayload.index).sort();
      expect(indices).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('useContext option', () => {
    it('should use forked EntityManager when useContext is false (default)', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);
      const driver = factory.create(createEventConfigResolver());

      expect(driver).toBeInstanceOf(MikroORMDatabaseDriver);
    });

    it('should use context EntityManager when useContext is true', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm, {
        useContext: true,
      });
      const driver = factory.create(createEventConfigResolver());

      expect(driver).toBeInstanceOf(MikroORMDatabaseDriver);
    });

    it('should support combining useContext with listenNotify options', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm, {
        useContext: true,
        listenNotify: {
          channelName: 'custom_channel',
        },
      });

      const driver = factory.create(createEventConfigResolver());
      const listener = factory.getEventListener() as PostgreSQLEventListener;

      expect(driver).toBeInstanceOf(MikroORMDatabaseDriver);
      expect(listener).toBeInstanceOf(PostgreSQLEventListener);
      expect(listener.channelName).toBe('custom_channel');
    });
  });

  describe('getEventListener', () => {
    it('should return PostgreSQLEventListener by default', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm);
      const listener = factory.getEventListener();

      expect(listener).toBeInstanceOf(PostgreSQLEventListener);
    });

    it('should return PostgreSQLEventListener with custom options', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm, {
        listenNotify: {
          channelName: 'custom_channel',
          reconnectDelayMs: 10000,
        },
      });
      const listener = factory.getEventListener() as PostgreSQLEventListener;

      expect(listener).toBeInstanceOf(PostgreSQLEventListener);
      expect(listener.channelName).toBe('custom_channel');
    });

    it('should return null when disabled', () => {
      const factory = new MikroORMDatabaseDriverFactory(orm, {
        listenNotify: { enabled: false },
      });
      const listener = factory.getEventListener();

      expect(listener).toBeNull();
    });

    it('should return null for MySQL driver', async () => {
      const mysqlDbName = await createTestDatabase('mysql');
      const mysqlOrm = await MikroORM.init({
        driver: MySqlDriver,
        host: MYSQL_CONNECTION.host,
        port: MYSQL_CONNECTION.port,
        user: MYSQL_CONNECTION.user,
        password: MYSQL_CONNECTION.password,
        dbName: mysqlDbName,
        entities: [MikroOrmOutboxTransportEvent],
        allowGlobalContext: true,
      });

      try {
        const factory = new MikroORMDatabaseDriverFactory(mysqlOrm);
        const listener = factory.getEventListener();

        expect(listener).toBeNull();
      } finally {
        await mysqlOrm.close();
        await dropTestDatabase(mysqlDbName, 'mysql');
      }
    });
  });
});
