# NestJS Outbox TypeORM Driver

[![npm version](https://badge.fury.io/js/%40fullstackhouse%2Fnestjs-outbox-typeorm-driver.svg)](https://www.npmjs.com/package/@fullstackhouse/nestjs-outbox-typeorm-driver)

TypeORM driver for [@fullstackhouse/nestjs-outbox](../core).

## Features

- **PostgreSQL & MySQL Support**: Works with postgres and mysql drivers

## Installation

```bash
npm install @fullstackhouse/nestjs-outbox-typeorm-driver
```

## Quick Start

```typescript
import { OutboxModule } from '@fullstackhouse/nestjs-outbox';
import {
  OutboxTransportEventMigrations,
  TypeORMDatabaseDriverFactory,
  TypeOrmOutboxTransportEvent,
} from '@fullstackhouse/nestjs-outbox-typeorm-driver';
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
      database: 'outbox',
      entities: [TypeOrmOutboxTransportEvent],
      migrations: [...OutboxTransportEventMigrations],
      migrationsRun: true,
    }),
    OutboxModule.registerAsync({
      imports: [TypeOrmModule.forFeature([TypeOrmOutboxTransportEvent])],
      useFactory: (dataSource: DataSource) => ({
        driverFactory: new TypeORMDatabaseDriverFactory(dataSource),
        events: [
          {
            name: 'OrderCreatedEvent',
            listeners: {
              retentionPeriod: 1000 * 60 * 60 * 24, // 24 hours
              maxExecutionTime: 1000 * 15,          // 15 seconds
              maxRetries: 5,                        // max retry attempts
            },
          },
        ],
        pollingInterval: 30_000,
        maxEventsPerPoll: 10,
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
