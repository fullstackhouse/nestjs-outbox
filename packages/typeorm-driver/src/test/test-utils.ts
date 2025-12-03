import { DataSource } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, DynamicModule, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxOutboxModule, InboxOutboxModuleEventOptions } from '@nestixis/nestjs-inbox-outbox';
import { TypeOrmInboxOutboxTransportEvent } from '../model/typeorm-inbox-outbox-transport-event.model';
import { TypeORMDatabaseDriverFactory } from '../driver/typeorm-database-driver.factory';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

export interface TestAppConfig {
  events: InboxOutboxModuleEventOptions[];
  additionalModules?: DynamicModule[];
  additionalEntities?: Type[];
  retryEveryMilliseconds?: number;
  maxInboxOutboxTransportEventPerRetry?: number;
}

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
  module: TestingModule;
  dbName: string;
}

export const BASE_CONNECTION = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
};

export async function createTestDatabase(): Promise<string> {
  const dbName = `test_inbox_outbox_${randomUUID().replace(/-/g, '_')}`;

  const client = new Client({
    ...BASE_CONNECTION,
    database: 'postgres',
  });
  await client.connect();
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  return dbName;
}

export async function dropTestDatabase(dbName: string): Promise<void> {
  const client = new Client({
    ...BASE_CONNECTION,
    database: 'postgres',
  });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await client.end();
}

export async function createTestApp(config: TestAppConfig): Promise<TestContext> {
  const dbName = await createTestDatabase();

  const typeOrmModule = TypeOrmModule.forRoot({
    type: 'postgres',
    host: BASE_CONNECTION.host,
    port: BASE_CONNECTION.port,
    username: BASE_CONNECTION.user,
    password: BASE_CONNECTION.password,
    database: dbName,
    entities: [TypeOrmInboxOutboxTransportEvent, ...(config.additionalEntities || [])],
    synchronize: true,
  });

  const inboxOutboxModule = InboxOutboxModule.registerAsync({
    imports: [TypeOrmModule],
    useFactory: (dataSource: DataSource) => {
      const driverFactory = new TypeORMDatabaseDriverFactory(dataSource);
      return {
        driverFactory,
        events: config.events,
        retryEveryMilliseconds: config.retryEveryMilliseconds ?? 10000,
        maxInboxOutboxTransportEventPerRetry: config.maxInboxOutboxTransportEventPerRetry ?? 100,
      };
    },
    inject: [DataSource],
    isGlobal: true,
  });

  const testingModule = await Test.createTestingModule({
    imports: [
      typeOrmModule,
      inboxOutboxModule,
      ...(config.additionalModules || []),
    ],
  }).compile();

  const app = testingModule.createNestApplication();
  await app.init();

  const dataSource = testingModule.get(DataSource);

  return {
    app,
    dataSource,
    module: testingModule,
    dbName,
  };
}

export async function cleanupTestApp(context: TestContext): Promise<void> {
  await context.app.close();
  if (context.dataSource.isInitialized) {
    await context.dataSource.destroy();
  }
  await dropTestDatabase(context.dbName);
}
