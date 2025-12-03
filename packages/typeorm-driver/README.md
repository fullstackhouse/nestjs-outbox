# NestJS Inbox Outbox TypeORM Driver

[![npm version](https://badge.fury.io/js/%40nestixis%2Fnestjs-inbox-outbox-typeorm-driver.svg)](https://www.npmjs.com/package/@nestixis/nestjs-inbox-outbox-typeorm-driver)

TypeORM driver for [@nestixis/nestjs-inbox-outbox](../core).

## Features

- **PostgreSQL & MySQL Support**: Works with postgres and mysql drivers

## Installation

```bash
npm install @nestixis/nestjs-inbox-outbox-typeorm-driver
```

## Quick Start

```typescript
import { InboxOutboxModule } from '@nestixis/nestjs-inbox-outbox';
import {
  InboxOutboxTransportEventMigrations,
  TypeORMDatabaseDriverFactory,
  TypeOrmInboxOutboxTransportEvent,
} from '@nestixis/nestjs-inbox-outbox-typeorm-driver';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'user',
      password: 'user',
      database: 'inbox_outbox',
      entities: [TypeOrmInboxOutboxTransportEvent],
      migrations: [...InboxOutboxTransportEventMigrations],
      migrationsRun: true,
    }),
    InboxOutboxModule.registerAsync({
      imports: [TypeOrmModule.forFeature([TypeOrmInboxOutboxTransportEvent])],
      useFactory: (dataSource: DataSource) => ({
        driverFactory: new TypeORMDatabaseDriverFactory(dataSource),
        events: [
          {
            name: 'OrderCreatedEvent',
            listeners: {
              expiresAtTTL: 1000 * 60 * 60 * 24,     // 24 hours
              maxExecutionTimeTTL: 1000 * 15,        // 15 seconds
              readyToRetryAfterTTL: 10000,           // 10 seconds
            },
          },
        ],
        retryEveryMilliseconds: 30_000,
        maxInboxOutboxTransportEventPerRetry: 10,
      }),
      inject: [DataSource],
    }),
  ],
})
export class AppModule {}
```

## Supported Databases

| Database   | Real-time Support |
|------------|-------------------|
| PostgreSQL | Polling only      |
| MySQL      | Polling only      |

## License

MIT
