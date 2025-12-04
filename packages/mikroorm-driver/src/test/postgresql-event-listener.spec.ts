import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Client } from 'pg';
import { firstValueFrom, take, toArray, timeout } from 'rxjs';
import {
  PostgreSQLEventListener,
  DEFAULT_POSTGRESQL_EVENT_CHANNEL,
} from '../listener/postgresql-event-listener';
import { MikroOrmInboxOutboxTransportEvent } from '../model/mikroorm-inbox-outbox-transport-event.model';
import { BASE_CONNECTION, createTestDatabase, dropTestDatabase, endPgClientSafely } from './test-utils';

describe('PostgreSQLEventListener', () => {
  let listener: PostgreSQLEventListener;
  let orm: MikroORM;
  let dbName: string;
  let notifyClient: Client;

  beforeEach(async () => {
    dbName = await createTestDatabase();

    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...BASE_CONNECTION,
      dbName,
      entities: [MikroOrmInboxOutboxTransportEvent],
      allowGlobalContext: true,
    });

    listener = new PostgreSQLEventListener(orm);

    notifyClient = new Client({
      ...BASE_CONNECTION,
      database: dbName,
    });
    await notifyClient.connect();
  });

  afterEach(async () => {
    await listener.disconnect();
    await endPgClientSafely(notifyClient);
    await orm.close();
    await dropTestDatabase(dbName);
  });

  it('should connect and listen for events', async () => {
    await listener.connect();

    const eventPromise = firstValueFrom(
      listener.events$.pipe(take(1), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, '123'`);

    const payload = await eventPromise;
    expect(payload).toBe('123');
  });

  it('should receive multiple events', async () => {
    await listener.connect();

    const eventsPromise = firstValueFrom(
      listener.events$.pipe(take(3), toArray(), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, '1'`);
    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, '2'`);
    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, '3'`);

    const payloads = await eventsPromise;
    expect(payloads).toEqual(['1', '2', '3']);
  });

  it('should ignore events on other channels', async () => {
    await listener.connect();

    let receivedEvent = false;
    const subscription = listener.events$.subscribe(() => {
      receivedEvent = true;
    });

    await notifyClient.query(`NOTIFY other_channel, 'ignored'`);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvent).toBe(false);
    subscription.unsubscribe();
  });

  it('should handle connect being called multiple times', async () => {
    await listener.connect();
    await listener.connect();

    const eventPromise = firstValueFrom(
      listener.events$.pipe(take(1), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, 'test'`);

    const payload = await eventPromise;
    expect(payload).toBe('test');
  });

  it('should handle disconnect gracefully', async () => {
    await listener.connect();

    const eventPromise = firstValueFrom(
      listener.events$.pipe(take(1), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, 'before-disconnect'`);

    const payload = await eventPromise;
    expect(payload).toBe('before-disconnect');

    await listener.disconnect();
  });

  it('should handle events with empty payload', async () => {
    await listener.connect();

    const eventPromise = firstValueFrom(
      listener.events$.pipe(take(1), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}`);

    const payload = await eventPromise;
    expect(payload).toBe('');
  });
});

describe('PostgreSQLEventListener reconnection', () => {
  let dbName: string;
  let orm: MikroORM;

  beforeEach(async () => {
    dbName = await createTestDatabase();

    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...BASE_CONNECTION,
      dbName,
      entities: [MikroOrmInboxOutboxTransportEvent],
      allowGlobalContext: true,
    });
  });

  afterEach(async () => {
    await orm.close();
    await dropTestDatabase(dbName);
  });

  it('should attempt to reconnect on connection error', async () => {
    const listener = new PostgreSQLEventListener(orm, { reconnectDelayMs: 100 });

    const connectSpy = vi.spyOn(listener, 'connect');

    await listener.connect();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await listener.disconnect();
  });

  it('should not attempt reconnection after disconnect is called', async () => {
    const listener = new PostgreSQLEventListener(orm, { reconnectDelayMs: 50 });

    const connectSpy = vi.spyOn(listener, 'connect');

    await listener.connect();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await listener.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PostgreSQLEventListener custom channel', () => {
  let listener: PostgreSQLEventListener;
  let orm: MikroORM;
  let dbName: string;
  let notifyClient: Client;
  const customChannel = 'my_custom_channel';

  beforeEach(async () => {
    dbName = await createTestDatabase();

    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...BASE_CONNECTION,
      dbName,
      entities: [MikroOrmInboxOutboxTransportEvent],
      allowGlobalContext: true,
    });

    listener = new PostgreSQLEventListener(orm, { channelName: customChannel });

    notifyClient = new Client({
      ...BASE_CONNECTION,
      database: dbName,
    });
    await notifyClient.connect();
  });

  afterEach(async () => {
    await listener.disconnect();
    await endPgClientSafely(notifyClient);
    await orm.close();
    await dropTestDatabase(dbName);
  });

  it('should use custom channel name', () => {
    expect(listener.channelName).toBe(customChannel);
  });

  it('should listen on custom channel', async () => {
    await listener.connect();

    const eventPromise = firstValueFrom(
      listener.events$.pipe(take(1), timeout(5000)),
    );

    await notifyClient.query(`NOTIFY ${customChannel}, 'custom-payload'`);

    const payload = await eventPromise;
    expect(payload).toBe('custom-payload');
  });

  it('should ignore events on default channel when using custom channel', async () => {
    await listener.connect();

    let receivedEvent = false;
    const subscription = listener.events$.subscribe(() => {
      receivedEvent = true;
    });

    await notifyClient.query(`NOTIFY ${DEFAULT_POSTGRESQL_EVENT_CHANNEL}, 'ignored'`);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvent).toBe(false);
    subscription.unsubscribe();
  });

  it('should use default channel name when not specified', () => {
    const defaultListener = new PostgreSQLEventListener(orm);
    expect(defaultListener.channelName).toBe(DEFAULT_POSTGRESQL_EVENT_CHANNEL);
  });
});
