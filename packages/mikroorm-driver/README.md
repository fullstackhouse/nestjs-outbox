# NestJS Outbox MikroORM Driver

[![npm version](https://badge.fury.io/js/%40fullstackhouse%2Fnestjs-outbox-mikro-orm-driver.svg)](https://www.npmjs.com/package/@fullstackhouse/nestjs-outbox-mikro-orm-driver)

MikroORM driver for [@fullstackhouse/nestjs-outbox](../core).

## Features

- **PostgreSQL & MySQL Support**: Works with PostgreSqlDriver and MySqlDriver
- **PostgreSQL LISTEN/NOTIFY**: Real-time event delivery enabled by default (PostgreSQL only)

## Installation

```bash
npm install @fullstackhouse/nestjs-outbox-mikro-orm-driver
```

## Quick Start

```typescript
import { MigrationObject, MikroORM } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { OutboxModule } from '@fullstackhouse/nestjs-outbox';
import {
  OutboxMigrations,
  MikroORMDatabaseDriverFactory,
  MikroOrmOutboxTransportEvent,
} from '@fullstackhouse/nestjs-outbox-mikro-orm-driver';
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

const migrationList = OutboxMigrations.map(mapMigration);

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      useFactory: () => ({
        host: 'localhost',
        dbName: 'outbox',
        user: 'user',
        password: 'user',
        port: 5432,
        migrations: {
          migrationsList: migrationList,
        },
        entities: [MikroOrmOutboxTransportEvent],
        driver: PostgreSqlDriver,
        extensions: [Migrator],
      }),
    }),
    OutboxModule.registerAsync({
      imports: [MikroOrmModule.forFeature([MikroOrmOutboxTransportEvent])],
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
        maxOutboxTransportEventPerRetry: 10,
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

// Enable AsyncLocalStorage context (for @Transactional() decorator)
new MikroORMDatabaseDriverFactory(orm, {
  useContext: true,
})
```

### How It Works

The `PostgreSQLEventListener`:
- Uses PostgreSQL triggers to send notifications on event insert
- Automatically reconnects on connection failures (configurable delay, default 5s)
- Works alongside polling as a fallback mechanism
- Requires the LISTEN/NOTIFY migration from `OutboxMigrations`

## @Transactional() Decorator Support

The driver supports MikroORM's `@Transactional()` decorator via AsyncLocalStorage context propagation. Enable `useContext: true` to participate in the same transaction:

```typescript
// Module setup
OutboxModule.registerAsync({
  imports: [MikroOrmModule],
  useFactory: (orm: MikroORM) => ({
    driverFactory: new MikroORMDatabaseDriverFactory(orm, {
      useContext: true, // Enable context propagation
    }),
    events: [...],
    retryEveryMilliseconds: 30_000,
    maxOutboxTransportEventPerRetry: 10,
  }),
  inject: [MikroORM],
}),
```

```typescript
// Service using @Transactional()
import { Transactional } from '@mikro-orm/core';

@Injectable()
export class OrderService {
  constructor(
    private em: EntityManager,
    private emitter: TransactionalEventEmitter,
  ) {}

  @Transactional()
  async createOrder(data: CreateOrderInput) {
    const order = this.em.create(Order, data);
    this.em.persist(order);

    // Event is persisted in the same transaction
    await this.emitter.emitAsync(new OrderCreatedEvent(order.id));

    return order;
  }
}
```

With `useContext: true`:
- Event persistence participates in the `@Transactional()` transaction
- Rollbacks affect both business data and events atomically
- No `em.clear()` after flush (preserves shared identity map)

## Supported Databases

| Database   | Real-time Support |
|------------|-------------------|
| PostgreSQL | LISTEN/NOTIFY     |
| MySQL      | Polling only      |

## License

MIT
