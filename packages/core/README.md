# NestJS Inbox Outbox

[![npm version](https://badge.fury.io/js/%40nestixis%2Fnestjs-inbox-outbox.svg)](https://www.npmjs.com/package/@nestixis/nestjs-inbox-outbox)

A NestJS module implementing the [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html) for reliable event delivery in distributed systems. Ensures atomic database updates and event emissions, preventing data inconsistencies when services crash or networks fail.

## Features

- **Atomic Operations**: Database changes and events are persisted in a single transaction
- **Guaranteed Delivery**: Polling mechanism ensures events are delivered even after crashes
- **PostgreSQL LISTEN/NOTIFY**: Real-time event delivery without polling latency (MikroORM + PostgreSQL only)
- **Graceful Shutdown**: In-flight events complete before application terminates
- **Multiple ORMs**: TypeORM and MikroORM drivers included
- **Flexible Processing**: Immediate or deferred event processing per event type

## How It Works

### Outbox Pattern
![outbox](https://github.com/user-attachments/assets/83fdb729-70dd-47f9-9449-cd40fe7ddd97)

### Inbox Pattern
![inbox](https://github.com/user-attachments/assets/fb67a80a-b963-4710-b0d7-a0c28c5fe6a7)

## Problems Solved

1. **Dual Write Consistency**: Database updates and event emissions are atomic—no partial failures
2. **Reliable Event Delivery**: Events survive network issues, service crashes, and downtime
3. **Cross-Module Consistency**: All system parts stay synchronized via guaranteed event delivery


## Installation

```bash
# Core package
npm install @nestixis/nestjs-inbox-outbox

# Choose your ORM driver
npm install @nestixis/nestjs-inbox-outbox-typeorm-driver
# or
npm install @nestixis/nestjs-inbox-outbox-mikroorm-driver
```

## Quick Start

### 1. Define an Event

```typescript
import { InboxOutboxEvent } from '@nestixis/nestjs-inbox-outbox';

export class OrderCreatedEvent implements InboxOutboxEvent {
  public readonly name = OrderCreatedEvent.name;

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
  ) {}
}
```

### 2. Create a Listener

```typescript
import { Listener, IListener } from '@nestixis/nestjs-inbox-outbox';

@Listener(OrderCreatedEvent.name)
export class SendOrderConfirmationListener implements IListener<OrderCreatedEvent> {
  constructor(private readonly emailService: EmailService) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    await this.emailService.sendOrderConfirmation(event.orderId);
  }
}
```

**Multiple events per listener:**

```typescript
@Listener([OrderCreatedEvent.name, OrderUpdatedEvent.name])
export class OrderNotificationListener
  implements IListener<OrderCreatedEvent | OrderUpdatedEvent> {

  async handle(event: OrderCreatedEvent | OrderUpdatedEvent): Promise<void> {
    // Handle both event types
  }
}
```

> **Note:** Only group related events in a single listener. Unrelated events should have separate listeners.

### 3. Emit Events

```typescript
import {
  TransactionalEventEmitter,
  TransactionalEventEmitterOperations
} from '@nestixis/nestjs-inbox-outbox';

@Injectable()
export class OrderService {
  constructor(private readonly eventEmitter: TransactionalEventEmitter) {}

  async createOrder(data: CreateOrderDto) {
    const order = new Order(data);

    // Event and entity are persisted atomically
    await this.eventEmitter.emit(
      new OrderCreatedEvent(order.id, data.customerId),
      [{ entity: order, operation: TransactionalEventEmitterOperations.persist }]
    );
  }
}
```

### 4. Register the Module

```typescript
import { InboxOutboxModule } from '@nestixis/nestjs-inbox-outbox';
import {
  TypeORMDatabaseDriverFactory,
  TypeOrmInboxOutboxTransportEvent,
  InboxOutboxTransportEventMigrations,
} from '@nestixis/nestjs-inbox-outbox-typeorm-driver';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      // ... your config
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
            name: OrderCreatedEvent.name,
            listeners: {
              expiresAtTTL: 1000 * 60 * 60 * 24,   // 24 hours
              maxExecutionTimeTTL: 1000 * 15,       // 15 seconds
              readyToRetryAfterTTL: 10000,          // 10 seconds
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

## Configuration

### Event Options

| Option | Description |
|--------|-------------|
| `name` | Event class name |
| `listeners.expiresAtTTL` | How long events are retained and retried (ms) |
| `listeners.maxExecutionTimeTTL` | Max listener execution time before retry (ms) |
| `listeners.readyToRetryAfterTTL` | Delay before retrying failed events (ms) |
| `immediateProcessing` | Process immediately (`true`, default) or defer to poller (`false`) |

### Module Options

| Option | Description |
|--------|-------------|
| `driverFactory` | Database driver factory instance |
| `events` | Array of event configurations |
| `retryEveryMilliseconds` | Polling interval for retry mechanism |
| `maxInboxOutboxTransportEventPerRetry` | Batch size per polling cycle |
| `isGlobal` | Register module globally (optional) |

## Emit Methods

| Method | Behavior |
|--------|----------|
| `emit()` | Persists event, attempts delivery, returns immediately |
| `emitAsync()` | Persists event, waits for all listeners to complete |

> **Note:** When `immediateProcessing: false`, both methods behave identically—they persist the event and return immediately. All processing happens via the poller.

## Immediate vs Deferred Processing

| Immediate (`true`, default) | Deferred (`false`) |
|-----------------------------|--------------------|
| Lower latency | Higher latency (waits for poller) |
| Best-effort first delivery | All delivery via poller |
| Most use cases | Fire-and-forget, safer crash recovery |

## Drivers

| Driver | Databases | Real-time Support |
|--------|-----------|-------------------|
| [TypeORM](./packages/typeorm-driver) | PostgreSQL, MySQL | Polling only |
| [MikroORM](./packages/mikroorm-driver) | PostgreSQL, MySQL | PostgreSQL LISTEN/NOTIFY |

## PostgreSQL LISTEN/NOTIFY (MikroORM)

For near-instant event delivery without polling latency, enable PostgreSQL LISTEN/NOTIFY:

```typescript
import { MikroORM } from '@mikro-orm/core';
import { InboxOutboxModule, EVENT_LISTENER_TOKEN } from '@nestixis/nestjs-inbox-outbox';
import {
  MikroORMDatabaseDriverFactory,
  PostgreSQLEventListener,
  InboxOutboxMigrations,
} from '@nestixis/nestjs-inbox-outbox-mikroorm-driver';

@Module({
  imports: [
    InboxOutboxModule.registerAsync({
      imports: [MikroOrmModule.forFeature([MikroOrmInboxOutboxTransportEvent])],
      useFactory: (orm: MikroORM) => ({
        driverFactory: new MikroORMDatabaseDriverFactory(orm),
        events: [/* ... */],
        retryEveryMilliseconds: 30_000,
        maxInboxOutboxTransportEventPerRetry: 10,
      }),
      inject: [MikroORM],
    }),
  ],
  providers: [
    {
      provide: EVENT_LISTENER_TOKEN,
      useFactory: (orm: MikroORM) => new PostgreSQLEventListener(orm),
      inject: [MikroORM],
    },
  ],
})
export class AppModule {}
```

The `PostgreSQLEventListener`:
- Uses PostgreSQL triggers to send notifications on event insert
- Automatically reconnects on connection failures (configurable delay, default 5s)
- Works alongside polling as a fallback mechanism
- Requires the LISTEN/NOTIFY migration from `InboxOutboxMigrations`

## Graceful Shutdown

The module automatically handles graceful shutdown:
- Tracks in-flight event processing
- Waits for all pending events to complete before shutdown
- Properly disconnects event listeners
- Prevents new event processing during shutdown


## Creating a Custom Driver

To support additional ORMs or databases:

1. **Implement `DatabaseDriver`** - Handle transactions, pessimistic locking, and persist/flush operations
2. **Implement `DatabaseDriverFactory`** - Factory to instantiate your driver
3. **Create a persistable model** - Implement `InboxOutboxTransportEvent` interface
4. **Add migrations** - Create the `inbox_outbox_transport_event` table

See existing drivers in `packages/` for reference. Contributions welcome via PR.

## License

MIT
