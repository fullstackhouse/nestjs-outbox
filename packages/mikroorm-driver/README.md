# NestJS Inbox Outbox MikroORM Driver

[![npm version](https://badge.fury.io/js/%40nestixis%2Fnestjs-inbox-outbox-mikroorm-driver.svg)](https://www.npmjs.com/package/@nestixis/nestjs-inbox-outbox-mikroorm-driver)

MikroORM driver for [@nestixis/nestjs-inbox-outbox](../core).

## Features

- **PostgreSQL & MySQL Support**: Works with PostgreSqlDriver and MySqlDriver
- **PostgreSQL LISTEN/NOTIFY**: Real-time event delivery enabled by default (PostgreSQL only)

## Installation

```bash
npm install @nestixis/nestjs-inbox-outbox-mikroorm-driver
```

## Quick Start

```typescript
import { MigrationObject, MikroORM } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { InboxOutboxModule } from '@nestixis/nestjs-inbox-outbox';
import {
  InboxOutboxMigrations,
  MikroORMDatabaseDriverFactory,
  MikroOrmInboxOutboxTransportEvent,
} from '@nestixis/nestjs-inbox-outbox-mikroorm-driver';
import { Module, OnApplicationBootstrap } from '@nestjs/common';

export class TableMigrator implements OnApplicationBootstrap {
  constructor(private mikroORM: MikroORM) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.mikroORM.getMigrator().up();
  }
}

const mapMigration = (migration): MigrationObject => ({
  name: migration.name,
  class: migration,
});

const migrationList = InboxOutboxMigrations.map(mapMigration);

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      useFactory: () => ({
        host: 'localhost',
        dbName: 'inbox_outbox',
        user: 'user',
        password: 'user',
        port: 5432,
        migrations: {
          migrationsList: migrationList,
        },
        entities: [MikroOrmInboxOutboxTransportEvent],
        driver: PostgreSqlDriver,
        extensions: [Migrator],
      }),
    }),
    InboxOutboxModule.registerAsync({
      imports: [MikroOrmModule.forFeature([MikroOrmInboxOutboxTransportEvent])],
      useFactory: (orm: MikroORM) => ({
        driverFactory: new MikroORMDatabaseDriverFactory(orm),
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
      inject: [MikroORM],
    }),
  ],
  providers: [TableMigrator],
})
export class AppModule {}
```

## PostgreSQL LISTEN/NOTIFY

LISTEN/NOTIFY is **enabled by default** when using PostgreSQL. The `MikroORMDatabaseDriverFactory` automatically creates a `PostgreSQLEventListener` that you can access via `getEventListener()`.

### Configuration Options

```typescript
// Default: LISTEN/NOTIFY enabled
new MikroORMDatabaseDriverFactory(orm)

// Custom options (channel name, reconnect delay)
new MikroORMDatabaseDriverFactory(orm, {
  listenNotify: {
    channelName: 'my_custom_channel',
    reconnectDelayMs: 10000,
  },
})

// Disable LISTEN/NOTIFY (polling only)
new MikroORMDatabaseDriverFactory(orm, {
  listenNotify: { enabled: false },
})
```

### How It Works

The `PostgreSQLEventListener`:
- Uses PostgreSQL triggers to send notifications on event insert
- Automatically reconnects on connection failures (configurable delay, default 5s)
- Works alongside polling as a fallback mechanism
- Requires the LISTEN/NOTIFY migration from `InboxOutboxMigrations`

## Supported Databases

| Database   | Real-time Support |
|------------|-------------------|
| PostgreSQL | LISTEN/NOTIFY     |
| MySQL      | Polling only      |

## License

MIT
