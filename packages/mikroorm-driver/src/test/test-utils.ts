import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MySqlDriver } from '@mikro-orm/mysql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, DynamicModule, Type } from '@nestjs/common';
import { InboxOutboxModule, InboxOutboxModuleEventOptions } from '@nestixis/nestjs-inbox-outbox';
import { MikroOrmInboxOutboxTransportEvent } from '../model/mikroorm-inbox-outbox-transport-event.model';
import { MikroORMDatabaseDriverFactory } from '../driver/mikroorm-database-driver.factory';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import * as mysql from 'mysql2/promise';

// Patch pg Client to handle missing activeQuery gracefully
// This fixes "Cannot read properties of undefined (reading 'handleEmptyQuery')"
// errors that occur when connections are closed while data is still being processed.
// This is a known issue in the pg library where _handleEmptyQuery doesn't null-check activeQuery.
const originalHandleEmptyQuery = (Client.prototype as unknown as { _handleEmptyQuery: () => void })._handleEmptyQuery;
(Client.prototype as unknown as { _handleEmptyQuery: () => void })._handleEmptyQuery = function () {
  if ((this as unknown as { activeQuery: unknown }).activeQuery) {
    originalHandleEmptyQuery.call(this);
  }
};

export type DatabaseType = 'postgresql' | 'mysql';

export interface TestAppConfig {
  events: InboxOutboxModuleEventOptions[];
  additionalModules?: DynamicModule[];
  additionalEntities?: Type[];
  retryEveryMilliseconds?: number;
  maxInboxOutboxTransportEventPerRetry?: number;
  databaseType?: DatabaseType;
  useContext?: boolean;
}

export interface TestContext {
  app: INestApplication;
  orm: MikroORM;
  module: TestingModule;
  dbName: string;
  databaseType: DatabaseType;
}

export const POSTGRESQL_CONNECTION = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
};

export const MYSQL_CONNECTION = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root',
};

export const BASE_CONNECTION = POSTGRESQL_CONNECTION;

export async function createTestDatabase(databaseType: DatabaseType = 'postgresql'): Promise<string> {
  const dbName = `test_inbox_outbox_${randomUUID().replace(/-/g, '_')}`;

  if (databaseType === 'mysql') {
    const connection = await mysql.createConnection({
      ...MYSQL_CONNECTION,
    });
    await connection.query(`CREATE DATABASE \`${dbName}\``);
    await connection.end();
  } else {
    const client = new Client({
      ...POSTGRESQL_CONNECTION,
      database: 'postgres',
    });
    client.on('error', () => {
      // Swallow errors during cleanup
    });
    await client.connect();
    await client.query(`CREATE DATABASE ${dbName}`);
    await endPgClientSafely(client);
  }

  return dbName;
}

export async function endPgClientSafely(client: Client): Promise<void> {
  client.removeAllListeners();
  const connection = (client as unknown as {
    connection: {
      removeAllListeners: (event?: string) => void;
      on: (event: string, handler: () => void) => void;
      stream?: { destroy: () => void };
    };
  }).connection;

  if (connection) {
    // Replace handlers that could throw when activeQuery is null
    connection.removeAllListeners('emptyQuery');
    connection.removeAllListeners('commandComplete');
    connection.on('emptyQuery', () => {});
    connection.on('commandComplete', () => {});
    if (connection.stream?.destroy) {
      connection.stream.destroy();
    }
  }

  try {
    await client.end();
  } catch {
    // Ignore errors during disconnect
  }
}

export async function dropTestDatabase(dbName: string, databaseType: DatabaseType = 'postgresql'): Promise<void> {
  if (databaseType === 'mysql') {
    const connection = await mysql.createConnection({
      ...MYSQL_CONNECTION,
    });
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.end();
  } else {
    const client = new Client({
      ...POSTGRESQL_CONNECTION,
      database: 'postgres',
    });
    client.on('error', () => {
      // Swallow errors during cleanup
    });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await endPgClientSafely(client);
  }
}

export async function createTestApp(config: TestAppConfig): Promise<TestContext> {
  const databaseType = config.databaseType ?? 'postgresql';
  const dbName = await createTestDatabase(databaseType);

  const mikroOrmModule = databaseType === 'mysql'
    ? MikroOrmModule.forRoot({
        driver: MySqlDriver,
        host: MYSQL_CONNECTION.host,
        port: MYSQL_CONNECTION.port,
        user: MYSQL_CONNECTION.user,
        password: MYSQL_CONNECTION.password,
        dbName,
        entities: [MikroOrmInboxOutboxTransportEvent, ...(config.additionalEntities || [])],
        allowGlobalContext: true,
      })
    : MikroOrmModule.forRoot({
        driver: PostgreSqlDriver,
        ...POSTGRESQL_CONNECTION,
        dbName,
        entities: [MikroOrmInboxOutboxTransportEvent, ...(config.additionalEntities || [])],
        allowGlobalContext: true,
      });

  const inboxOutboxModule = InboxOutboxModule.registerAsync({
    imports: [MikroOrmModule],
    useFactory: (orm: MikroORM) => {
      const driverFactory = new MikroORMDatabaseDriverFactory(orm, {
        useContext: config.useContext,
      });
      return {
        driverFactory,
        events: config.events,
        retryEveryMilliseconds: config.retryEveryMilliseconds ?? 10000,
        maxInboxOutboxTransportEventPerRetry: config.maxInboxOutboxTransportEventPerRetry ?? 100,
      };
    },
    inject: [MikroORM],
    isGlobal: true,
  });

  const testingModule = await Test.createTestingModule({
    imports: [
      mikroOrmModule,
      inboxOutboxModule,
      ...(config.additionalModules || []),
    ],
  }).compile();

  const app = testingModule.createNestApplication();
  await app.init();

  const orm = testingModule.get(MikroORM);

  await createSchema(orm);

  return {
    app,
    orm,
    module: testingModule,
    dbName,
    databaseType,
  };
}

async function createSchema(orm: MikroORM): Promise<void> {
  const generator = orm.getSchemaGenerator();
  await generator.createSchema();
}

export async function cleanupTestApp(context: TestContext): Promise<void> {
  await context.app.close();
  await context.orm.close();
  await dropTestDatabase(context.dbName, context.databaseType);
}
