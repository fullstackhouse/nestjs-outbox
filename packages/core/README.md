# NestJS Outbox

[![npm version](https://badge.fury.io/js/%40fullstackhouse%2Fnestjs-outbox.svg)](https://www.npmjs.com/package/@fullstackhouse/nestjs-outbox)

A NestJS module implementing the [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html) for reliable event delivery in distributed systems. Ensures atomic database updates and event emissions, preventing data inconsistencies when services crash or networks fail.

## Features

- **Atomic Operations**: Database changes and events are persisted in a single transaction
- **Guaranteed Delivery**: Polling mechanism ensures events are delivered even after crashes
- **PostgreSQL LISTEN/NOTIFY**: Real-time event delivery without polling latency (MikroORM + PostgreSQL only)
- **Graceful Shutdown**: In-flight events complete before application terminates
- **Multiple ORMs**: TypeORM and MikroORM drivers included
- **Flexible Processing**: Immediate or deferred event processing per event type
- **Middleware Support**: Intercept event processing for logging, tracing, and error reporting

## How It Works

### Outbox Pattern
![outbox](https://github.com/user-attachments/assets/83fdb729-70dd-47f9-9449-cd40fe7ddd97)


## Problems Solved

1. **Dual Write Consistency**: Database updates and event emissions are atomic—no partial failures
2. **Reliable Event Delivery**: Events survive network issues, service crashes, and downtime
3. **Cross-Module Consistency**: All system parts stay synchronized via guaranteed event delivery


## Installation

```bash
# Core package
npm install @fullstackhouse/nestjs-outbox

# Choose your ORM driver
npm install @fullstackhouse/nestjs-outbox-typeorm-driver
# or
npm install @fullstackhouse/nestjs-outbox-mikro-orm-driver
```

## Quick Start

### 1. Define an Event

```typescript
import { OutboxEvent } from '@fullstackhouse/nestjs-outbox';

export class OrderCreatedEvent implements OutboxEvent {
  public readonly name = OrderCreatedEvent.name;

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
  ) {}
}
```

### 2. Create a Listener

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@fullstackhouse/nestjs-outbox';

@Injectable()
export class OrderNotificationListener {
  constructor(private readonly emailService: EmailService) {}

  @OnEvent(OrderCreatedEvent.name)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.emailService.sendOrderConfirmation(event.orderId);
  }
}
```

**Multiple event handlers in one class:**

```typescript
@Injectable()
export class OrderNotificationListener {
  @OnEvent(OrderCreatedEvent.name)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    // Handle order created
  }

  @OnEvent(OrderUpdatedEvent.name)
  async handleOrderUpdated(event: OrderUpdatedEvent): Promise<void> {
    // Handle order updated
  }
}
```

### 3. Emit Events

```typescript
import {
  TransactionalEventEmitter,
  TransactionalEventEmitterOperations
} from '@fullstackhouse/nestjs-outbox';

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
import { OutboxModule } from '@fullstackhouse/nestjs-outbox';
import {
  TypeORMDatabaseDriverFactory,
  TypeOrmOutboxTransportEvent,
  OutboxTransportEventMigrations,
} from '@fullstackhouse/nestjs-outbox-typeorm-driver';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      // ... your config
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
            name: OrderCreatedEvent.name,
            listeners: {
              expiresAtTTL: 1000 * 60 * 60 * 24,   // 24 hours
              maxExecutionTimeTTL: 1000 * 15,       // 15 seconds
              readyToRetryAfterTTL: 10000,          // 10 seconds
            },
          },
        ],
        retryEveryMilliseconds: 30_000,
        maxOutboxTransportEventPerRetry: 10,
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
| `maxOutboxTransportEventPerRetry` | Batch size per polling cycle |
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

LISTEN/NOTIFY is **enabled by default** when using the MikroORM driver with PostgreSQL. Just use `MikroORMDatabaseDriverFactory` and the module handles everything automatically:

```typescript
import { MikroORM } from '@mikro-orm/core';
import { OutboxModule } from '@fullstackhouse/nestjs-outbox';
import { MikroORMDatabaseDriverFactory } from '@fullstackhouse/nestjs-outbox-mikro-orm-driver';

@Module({
  imports: [
    OutboxModule.registerAsync({
      imports: [MikroOrmModule.forFeature([MikroOrmOutboxTransportEvent])],
      useFactory: (orm: MikroORM) => ({
        driverFactory: new MikroORMDatabaseDriverFactory(orm),
        events: [/* ... */],
        retryEveryMilliseconds: 30_000,
        maxOutboxTransportEventPerRetry: 10,
      }),
      inject: [MikroORM],
    }),
  ],
})
export class AppModule {}
```

To disable LISTEN/NOTIFY and use polling only:

```typescript
new MikroORMDatabaseDriverFactory(orm, { listenNotify: { enabled: false } })
```

The `PostgreSQLEventListener`:
- Uses PostgreSQL triggers to send notifications on event insert
- Automatically reconnects on connection failures (configurable delay, default 5s)
- Works alongside polling as a fallback mechanism
- Requires the LISTEN/NOTIFY migration from `OutboxMigrations`

## Middleware

Middlewares intercept event processing for cross-cutting concerns like logging, tracing, or error reporting. Middlewares are NestJS injectable classes with full dependency injection support.

### Creating a Middleware

Implement the `OutboxMiddleware` interface with one or more lifecycle hooks:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  OutboxMiddleware,
  OutboxEventContext,
  OutboxListenerResult,
} from '@fullstackhouse/nestjs-outbox';

@Injectable()
export class LoggingMiddleware implements OutboxMiddleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  beforeProcess(context: OutboxEventContext): void {
    this.logger.log(`Processing ${context.eventName} (id=${context.eventId}) → ${context.listenerName}`);
  }

  afterProcess(context: OutboxEventContext, result: OutboxListenerResult): void {
    this.logger.log(`Completed ${context.eventName} in ${result.durationMs}ms`);
  }

  onError(context: OutboxEventContext, error: Error): void {
    this.logger.error(`Failed ${context.eventName}: ${error.message}`);
  }
}
```

### Lifecycle Hooks

| Hook | Description |
|------|-------------|
| `beforeProcess(context)` | Called before listener execution |
| `afterProcess(context, result)` | Called after successful execution with timing info |
| `onError(context, error)` | Called when listener throws an error |
| `wrapExecution(context, next)` | Wraps the entire execution for full control |

### Context Objects

**OutboxEventContext**
```typescript
interface OutboxEventContext {
  eventName: string;      // Event class name
  eventPayload: unknown;  // Deserialized event data
  eventId: number;        // Database ID of the outbox event
  listenerName: string;   // Name of the listener being invoked
}
```

**OutboxListenerResult** (passed to `afterProcess`)
```typescript
interface OutboxListenerResult {
  success: boolean;
  error?: Error;
  durationMs: number;
}
```

### Registering Middlewares

Pass middleware classes via the `middlewares` option. Middleware classes must be registered as providers (either in the same module or imported):

```typescript
import { OutboxModule } from '@fullstackhouse/nestjs-outbox';
import { MikroORMDatabaseDriverFactory } from '@fullstackhouse/nestjs-outbox-mikro-orm-driver';

@Module({
  imports: [
    OutboxModule.registerAsync({
      imports: [MikroOrmModule.forFeature([MikroOrmOutboxTransportEvent])],
      useFactory: (orm: MikroORM) => ({
        driverFactory: new MikroORMDatabaseDriverFactory(orm),
        events: [/* ... */],
        retryEveryMilliseconds: 30_000,
        maxOutboxTransportEventPerRetry: 10,
        middlewares: [LoggingMiddleware, SentryMiddleware],
      }),
      inject: [MikroORM],
    }),
  ],
  providers: [LoggingMiddleware, SentryMiddleware],
})
export class AppModule {}
```

### Common Middleware Examples

**Error Reporting (Sentry)**
```typescript
@Injectable()
export class SentryMiddleware implements OutboxMiddleware {
  onError(context: OutboxEventContext, error: Error): void {
    Sentry.captureException(error, {
      tags: {
        eventName: context.eventName,
        eventId: String(context.eventId),
        listenerName: context.listenerName,
      },
    });
  }
}
```

**OpenTelemetry Tracing**
```typescript
@Injectable()
export class TracingMiddleware implements OutboxMiddleware {
  async wrapExecution<T>(context: OutboxEventContext, next: () => Promise<T>): Promise<T> {
    const span = tracer.startSpan('outbox.process', {
      attributes: {
        'event.name': context.eventName,
        'event.id': context.eventId,
        'listener.name': context.listenerName,
      },
    });

    try {
      const result = await next();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }
}
```

**Metrics Collection**
```typescript
@Injectable()
export class MetricsMiddleware implements OutboxMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  afterProcess(context: OutboxEventContext, result: OutboxListenerResult): void {
    this.metrics.recordHistogram('outbox.processing.duration', result.durationMs, {
      event: context.eventName,
      listener: context.listenerName,
      success: String(result.success),
    });
  }

  onError(context: OutboxEventContext, error: Error): void {
    this.metrics.incrementCounter('outbox.processing.errors', {
      event: context.eventName,
      listener: context.listenerName,
    });
  }
}
```

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
3. **Create a persistable model** - Implement `OutboxTransportEvent` interface
4. **Add migrations** - Create the `outbox_transport_event` table

See existing drivers in `packages/` for reference. Contributions welcome via PR.

## Releasing

Publishing to npm is automated via GitHub releases using [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) with OIDC—no npm tokens required.

Create a new release with a tag like `v2.1.0` and the workflow will:
1. Extract version from the tag (strips `v` prefix)
2. Update all package versions
3. Build and publish to npm with provenance attestations

## License

MIT
