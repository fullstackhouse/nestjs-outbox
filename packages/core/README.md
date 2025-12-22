# NestJS Outbox

[![npm version](https://badge.fury.io/js/%40fullstackhouse%2Fnestjs-outbox.svg)](https://www.npmjs.com/package/@fullstackhouse/nestjs-outbox)

A NestJS module implementing the [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html) for reliable event delivery in distributed systems. Ensures atomic database updates and event emissions, preventing data inconsistencies when services crash or networks fail.

## Features

- **Atomic Operations**: Database changes and events are persisted in a single transaction
- **Guaranteed Delivery**: Polling mechanism ensures events are delivered even after crashes
- **PostgreSQL LISTEN/NOTIFY**: Real-time event delivery without polling latency (MikroORM + PostgreSQL only)
- **Graceful Shutdown**: In-flight events complete before application terminates
- **Multiple ORMs**: TypeORM and MikroORM drivers included
- **Deferred Processing**: Events are always processed by the background poller, ensuring exactly-once delivery
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

# Optional: OpenTelemetry tracing
npm install @fullstackhouse/nestjs-outbox-tracing
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

### Module Options

| Option | Description |
|--------|-------------|
| `driverFactory` | Database driver factory instance |
| `events` | Array of event configurations |
| `retryEveryMilliseconds` | Polling interval for retry mechanism |
| `maxOutboxTransportEventPerRetry` | Batch size per polling cycle |
| `isGlobal` | Register module globally (optional) |
| `enableDefaultMiddlewares` | Enable default middlewares like LoggerMiddleware (default: `true`) |
| `middlewares` | Array of custom middleware classes |

## Event Processing

Events are **never processed immediately** during `emit()`. Instead:

1. `emit()` persists the event to the database and returns immediately
2. The background poller (or PostgreSQL NOTIFY listener) picks up the event
3. The event is processed with **pessimistic row locking** to prevent duplicate processing

This design ensures:
- **No race conditions**: Events are never processed in parallel by multiple workers
- **Crash safety**: If the server crashes after `emit()`, the event is still delivered
- **Exactly-once delivery**: Row locking prevents duplicate processing across instances

```
emit() → persist to DB → return immediately
                ↓
   PostgreSQL NOTIFY or polling interval
                ↓
   Poller acquires row lock, processes event
                ↓
   Event removed from outbox on success
```

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

### Built-in LoggerMiddleware

The module includes a `LoggerMiddleware` that is **enabled by default**. It logs:
- `OUTBOX START {eventName}` - when processing begins
- `OUTBOX END   {eventName}` - when processing succeeds (with duration)
- `OUTBOX FAIL  {eventName}` - when processing fails (with error)

Each log includes context: `eventId`, `listener`, `payload`, and `processTime`.

To disable the built-in logger:

```typescript
OutboxModule.registerAsync({
  enableDefaultMiddlewares: false,
  // ... other options
})
```

### Creating a Custom Middleware

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

Pass middleware classes via the `middlewares` option. The module registers them as providers and injects their instances:

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
      }),
      inject: [MikroORM],
      middlewares: [LoggingMiddleware, SentryMiddleware],
    }),
  ],
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

Use the `@fullstackhouse/nestjs-outbox-tracing` package for built-in OpenTelemetry support:

```typescript
import { TracingOutboxMiddleware, TRACING_OUTBOX_OPTIONS } from '@fullstackhouse/nestjs-outbox-tracing';

@Module({
  imports: [
    OutboxModule.registerAsync({
      // ...
      middlewares: [TracingOutboxMiddleware],
    }),
  ],
  providers: [
    {
      provide: TRACING_OUTBOX_OPTIONS,
      useValue: {
        tracerName: 'my-service',           // default: 'nestjs-outbox'
        traceContextFieldName: '_trace',    // default: '_traceContext'
      },
    },
  ],
})
export class AppModule {}
```

The middleware:
- Injects trace context into events via `beforeEmit` for distributed tracing
- Creates consumer spans with `outbox.event_id`, `outbox.event_name`, `outbox.listener` attributes
- Extracts parent context from event payload to link producer and consumer spans

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

## Exception Filters

NestJS global exception filters are automatically invoked when outbox listeners throw errors. Register your exception filter using NestJS's standard `APP_FILTER` token:

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

@Module({
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
  ],
})
export class AppModule {}
```

The filter receives an `ArgumentsHost` with type `'outbox'`. Use `isOutboxContext()` to check the context type:

```typescript
import { Catch, ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { isOutboxContext } from '@fullstackhouse/nestjs-outbox';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    if (!isOutboxContext(host)) return;

    const context = host.switchToOutbox().getContext();
    Sentry.captureException(exception, {
      tags: {
        eventName: context.eventName,
        listenerName: context.listenerName,
      },
      extra: {
        eventId: context.eventId,
        eventPayload: context.eventPayload,
      },
    });
  }
}
```

You can also create a unified filter that handles both HTTP and outbox contexts:

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    if (isOutboxContext(host)) {
      const ctx = host.switchToOutbox().getContext();
      // Handle outbox error
    } else if (host.getType() === 'http') {
      const ctx = host.switchToHttp();
      // Handle HTTP error
    }
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
