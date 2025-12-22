import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MySqlDriver } from '@mikro-orm/mysql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, DynamicModule, Type } from '@nestjs/common';
import { OutboxModule, OutboxModuleEventOptions } from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { MikroORMDatabaseDriverFactory } from '../driver/mikroorm-database-driver.factory';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import * as mysql from 'mysql2/promise';

export type DatabaseType = 'postgresql' | 'mysql';

export interface TestAppConfig {
  events: OutboxModuleEventOptions[];
  additionalModules?: DynamicModule[];
  additionalEntities?: Type[];
  retryEveryMilliseconds?: number;
  maxOutboxTransportEventPerRetry?: number;
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
    await client.connect();
    await client.query(`CREATE DATABASE ${dbName}`);
    await client.end();
  }

  return dbName;
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
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await client.end();
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
        entities: [MikroOrmOutboxTransportEvent, ...(config.additionalEntities || [])],
        allowGlobalContext: true,
      })
    : MikroOrmModule.forRoot({
        driver: PostgreSqlDriver,
        ...POSTGRESQL_CONNECTION,
        dbName,
        entities: [MikroOrmOutboxTransportEvent, ...(config.additionalEntities || [])],
        allowGlobalContext: true,
      });

  const inboxOutboxModule = OutboxModule.registerAsync({
    imports: [MikroOrmModule],
    useFactory: (orm: MikroORM) => {
      const driverFactory = new MikroORMDatabaseDriverFactory(orm, {
        useContext: config.useContext,
      });
      return {
        driverFactory,
        events: config.events,
        retryEveryMilliseconds: config.retryEveryMilliseconds ?? 10000,
        maxOutboxTransportEventPerRetry: config.maxOutboxTransportEventPerRetry ?? 100,
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
