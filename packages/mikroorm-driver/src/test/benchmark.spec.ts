import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MikroORM } from '@mikro-orm/core';
import {
  TransactionalEventEmitter,
  OutboxEvent,
  IListener,
  OutboxEventFlusher,
  DATABASE_DRIVER_FACTORY_TOKEN,
  DatabaseDriverFactory,
  EVENT_CONFIGURATION_RESOLVER_TOKEN,
  EventConfigurationResolverContract,
} from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { createTestApp, cleanupTestApp, TestContext } from './test-utils';

class BenchmarkEvent extends OutboxEvent {
  public readonly name = 'BenchmarkEvent';

  constructor(
    public readonly id: number,
    public readonly data: string,
  ) {
    super();
  }
}

class RetryableEvent extends OutboxEvent {
  public readonly name = 'RetryableEvent';

  constructor(
    public readonly id: number,
    public readonly shouldFail: boolean,
  ) {
    super();
  }
}

describe('Outbox Benchmark Tests (PostgreSQL)', () => {
  let context: TestContext;

  afterEach(async () => {
    if (context) {
      await cleanupTestApp(context);
    }
  });

  describe('Parallel Event Emission', () => {
    beforeEach(async () => {
      context = await createTestApp({
        events: [
          {
            name: 'BenchmarkEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: 3,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
      });
    });

    it('should handle many events emitted in parallel', async () => {
      const eventCount = 100;
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const startTime = performance.now();

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      const endTime = performance.now();
      const durationMs = endTime - startTime;
      const eventsPerSecond = (eventCount / durationMs) * 1000;

      console.log(`[Parallel Event Emission] ${eventCount} events emitted in parallel`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Events per second: ${eventsPerSecond.toFixed(2)}`);
      console.log(`  Avg time per event: ${(durationMs / eventCount).toFixed(2)}ms`);

      const em = orm.em.fork();
      const persistedEvents = await em.find(MikroOrmOutboxTransportEvent, { eventName: 'BenchmarkEvent' });
      expect(persistedEvents).toHaveLength(eventCount);
    });

    it('should handle sequential batch emission', async () => {
      const batchCount = 10;
      const eventsPerBatch = 50;
      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const startTime = performance.now();

      for (let batch = 0; batch < batchCount; batch++) {
        await Promise.all(
          Array.from({ length: eventsPerBatch }, (_, i) =>
            emitter.emit(new BenchmarkEvent(batch * eventsPerBatch + i, `batch-${batch}-event-${i}`))
          )
        );
      }

      const endTime = performance.now();
      const totalEvents = batchCount * eventsPerBatch;
      const durationMs = endTime - startTime;

      console.log(`[Sequential Batch Emission] ${batchCount} batches of ${eventsPerBatch} events`);
      console.log(`  Total events: ${totalEvents}`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Avg time per batch: ${(durationMs / batchCount).toFixed(2)}ms`);

      const em = orm.em.fork();
      const persistedEvents = await em.find(MikroOrmOutboxTransportEvent, { eventName: 'BenchmarkEvent' });
      expect(persistedEvents).toHaveLength(totalEvents);
    });
  });

  describe('Parallel Event Processing', () => {
    beforeEach(async () => {
      context = await createTestApp({
        events: [
          {
            name: 'BenchmarkEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: 3,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
        maxEventsPerPoll: 1000,
      });
    });

    it('should handle many events processed in parallel with multiple listeners', async () => {
      const eventCount = 100;
      const listenerCount = 5;
      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const orm = context.orm;

      const handledCounts: number[] = Array(listenerCount).fill(0);

      for (let i = 0; i < listenerCount; i++) {
        const listener: IListener<BenchmarkEvent> = {
          getName: () => `BenchmarkListener${i}`,
          handle: async () => {
            handledCounts[i]++;
          },
        };
        emitter.addListener('BenchmarkEvent', listener);
      }

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      const startTime = performance.now();
      await flusher.processAllPendingEvents();
      const endTime = performance.now();

      const durationMs = endTime - startTime;
      const eventsPerSecond = (eventCount / durationMs) * 1000;

      console.log(`[Parallel Event Processing] ${eventCount} events with ${listenerCount} listeners`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Events per second: ${eventsPerSecond.toFixed(2)}`);
      console.log(`  Avg time per event: ${(durationMs / eventCount).toFixed(2)}ms`);

      for (let i = 0; i < listenerCount; i++) {
        expect(handledCounts[i]).toBe(eventCount);
      }

      const em = orm.em.fork();
      const remainingEvents = await em.find(MikroOrmOutboxTransportEvent, { eventName: 'BenchmarkEvent' });
      expect(remainingEvents).toHaveLength(0);
    });

    it('should maintain correctness under high concurrency', async () => {
      const eventCount = 50;
      const listenerCount = 10;
      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);

      const processedEventIds = new Set<number>();
      const listenerCalls: Map<string, number[]> = new Map();

      for (let i = 0; i < listenerCount; i++) {
        const listenerName = `ConcurrencyListener${i}`;
        listenerCalls.set(listenerName, []);

        const listener: IListener<BenchmarkEvent> = {
          getName: () => listenerName,
          handle: async (event: BenchmarkEvent) => {
            processedEventIds.add(event.id);
            listenerCalls.get(listenerName)!.push(event.id);
          },
        };
        emitter.addListener('BenchmarkEvent', listener);
      }

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      await flusher.processAllPendingEvents();

      expect(processedEventIds.size).toBe(eventCount);

      for (const [listenerName, ids] of listenerCalls) {
        expect(ids.length).toBe(eventCount);
      }
    });
  });

  describe('DLQ Events Handling', () => {
    it('should handle many DLQ events efficiently', async () => {
      const dlqEventCount = 50;
      const maxRetries = 2;

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const driverFactory = context.module.get<DatabaseDriverFactory>(DATABASE_DRIVER_FACTORY_TOKEN);
      const eventConfigResolver = context.module.get<EventConfigurationResolverContract>(EVENT_CONFIGURATION_RESOLVER_TOKEN);
      const orm = context.orm;

      emitter.addListener('RetryableEvent', {
        getName: () => 'AlwaysFailingListener',
        handle: async () => {
          throw new Error('Always fails');
        },
      });

      await Promise.all(
        Array.from({ length: dlqEventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, true))
        )
      );

      const startTime = performance.now();

      // Simulate retry loop:
      // 1. Set attemptAt to make events ready
      // 2. Use findAndExtendReadyToRetryEvents to increment retryCount (this is what the poller does)
      // 3. Use processAllPendingEvents to process them
      for (let retry = 0; retry <= maxRetries + 1; retry++) {
        const em = orm.em.fork();
        const pendingEvents = await em.find(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'pending',
        });

        if (pendingEvents.length === 0) break;

        // Make events ready for retry by setting attemptAt to now
        for (const event of pendingEvents) {
          event.attemptAt = Date.now();
        }
        await em.flush();

        // findAndExtendReadyToRetryEvents increments retryCount and may set status to 'failed'
        const driver = driverFactory.create(eventConfigResolver);
        await driver.findAndExtendReadyToRetryEvents(1000);

        // Process events that are still pending
        await flusher.processAllPendingEvents();
      }

      const endTime = performance.now();
      const durationMs = endTime - startTime;

      console.log(`[DLQ Events Handling] ${dlqEventCount} events failed after ${maxRetries + 1} attempts`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Avg time per event (including retries): ${(durationMs / dlqEventCount).toFixed(2)}ms`);

      const em = orm.em.fork();
      const failedEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'failed',
      });

      expect(failedEvents.length).toBe(dlqEventCount);
    });

    it('should continue processing when some handlers fail', async () => {
      const eventCount = 30;
      let successfulCalls = 0;
      let failedCalls = 0;

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: 0,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const orm = context.orm;

      emitter.addListener('RetryableEvent', {
        getName: () => 'ConditionalListener',
        handle: async (event: RetryableEvent) => {
          if (event.shouldFail) {
            failedCalls++;
            throw new Error('Intentional failure');
          }
          successfulCalls++;
        },
      });

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, i % 2 === 0))
        )
      );

      await flusher.processAllPendingEvents();

      expect(successfulCalls).toBe(eventCount / 2);
      expect(failedCalls).toBe(eventCount / 2);

      const em = orm.em.fork();
      const successfulEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'pending',
        deliveredToListeners: { $ne: [] },
      });

      expect(successfulEvents.length).toBe(0);
    });
  });

  describe('Event Retries', () => {
    it('should handle many retried events efficiently', async () => {
      const eventCount = 30;
      const maxRetries = 3;
      let attemptCounts: Map<number, number> = new Map();

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const driverFactory = context.module.get<DatabaseDriverFactory>(DATABASE_DRIVER_FACTORY_TOKEN);
      const eventConfigResolver = context.module.get<EventConfigurationResolverContract>(EVENT_CONFIGURATION_RESOLVER_TOKEN);
      const orm = context.orm;

      // Listener that fails once, then succeeds on second attempt
      emitter.addListener('RetryableEvent', {
        getName: () => 'RetryTrackingListener',
        handle: async (event: RetryableEvent) => {
          const count = (attemptCounts.get(event.id) || 0) + 1;
          attemptCounts.set(event.id, count);

          if (count < 2) {
            throw new Error(`Retry ${count}`);
          }
        },
      });

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, false))
        )
      );

      const startTime = performance.now();

      // Process events using proper retry mechanism
      for (let retry = 0; retry <= maxRetries; retry++) {
        const em = orm.em.fork();
        const pendingEvents = await em.find(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'pending',
        });

        if (pendingEvents.length === 0) break;

        for (const event of pendingEvents) {
          event.attemptAt = Date.now();
        }
        await em.flush();

        // findAndExtendReadyToRetryEvents increments retryCount
        const driver = driverFactory.create(eventConfigResolver);
        await driver.findAndExtendReadyToRetryEvents(1000);

        // Process events
        await flusher.processAllPendingEvents();
      }

      const endTime = performance.now();
      const durationMs = endTime - startTime;

      console.log(`[Event Retries] ${eventCount} events with up to ${maxRetries} retries`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Avg time per event (including retries): ${(durationMs / eventCount).toFixed(2)}ms`);

      // Each event should have been attempted exactly 2 times (fail once, succeed once)
      for (const [eventId, count] of attemptCounts) {
        expect(count).toBe(2);
      }

      const em = orm.em.fork();
      const remainingEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'pending',
      });
      expect(remainingEvents).toHaveLength(0);
    });

    it('should track partial delivery correctly during retries', async () => {
      const eventCount = 20;

      context = await createTestApp({
        events: [
          {
            name: 'BenchmarkEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: 5,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const orm = context.orm;

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'AlwaysSucceedsListener',
        handle: async () => {},
      });

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'AlwaysFailsListener',
        handle: async () => {
          throw new Error('Always fails');
        },
      });

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      await flusher.processAllPendingEvents();

      const em = orm.em.fork();
      const events = await em.find(MikroOrmOutboxTransportEvent, { eventName: 'BenchmarkEvent' });

      expect(events.length).toBe(eventCount);

      for (const event of events) {
        expect(event.deliveredToListeners).toContain('AlwaysSucceedsListener');
        expect(event.deliveredToListeners).not.toContain('AlwaysFailsListener');
      }
    });
  });

  describe('Combined Load Test', () => {
    it('should handle realistic mixed workload', async () => {
      const successEventCount = 50;
      const failingEventCount = 10;
      let processedSuccessCount = 0;
      const maxRetriesForFailing = 1;

      context = await createTestApp({
        events: [
          {
            name: 'BenchmarkEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: 3,
              maxExecutionTime: 30000,
            },
          },
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries: maxRetriesForFailing,
              maxExecutionTime: 30000,
            },
          },
        ],
        pollingInterval: 100000,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const flusher = context.module.get(OutboxEventFlusher);
      const driverFactory = context.module.get<DatabaseDriverFactory>(DATABASE_DRIVER_FACTORY_TOKEN);
      const eventConfigResolver = context.module.get<EventConfigurationResolverContract>(EVENT_CONFIGURATION_RESOLVER_TOKEN);
      const orm = context.orm;

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'SuccessfulListener',
        handle: async () => {
          processedSuccessCount++;
        },
      });

      emitter.addListener('RetryableEvent', {
        getName: () => 'FailingListener',
        handle: async () => {
          throw new Error('Always fails');
        },
      });

      const emitStartTime = performance.now();

      await Promise.all([
        ...Array.from({ length: successEventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `success-${i}`))
        ),
        ...Array.from({ length: failingEventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, true))
        ),
      ]);

      const emitEndTime = performance.now();

      const processStartTime = performance.now();

      // Use proper retry mechanism with findAndExtendReadyToRetryEvents
      for (let retry = 0; retry <= maxRetriesForFailing + 1; retry++) {
        const em = orm.em.fork();
        const pendingEvents = await em.find(MikroOrmOutboxTransportEvent, {
          status: 'pending',
        });

        if (pendingEvents.length === 0) break;

        for (const event of pendingEvents) {
          event.attemptAt = Date.now();
        }
        await em.flush();

        // findAndExtendReadyToRetryEvents increments retryCount
        const driver = driverFactory.create(eventConfigResolver);
        await driver.findAndExtendReadyToRetryEvents(1000);

        // Process events
        await flusher.processAllPendingEvents();
      }

      const processEndTime = performance.now();

      console.log(`[Combined Load Test] ${successEventCount} success + ${failingEventCount} failing events`);
      console.log(`  Emit duration: ${(emitEndTime - emitStartTime).toFixed(2)}ms`);
      console.log(`  Process duration: ${(processEndTime - processStartTime).toFixed(2)}ms`);
      console.log(`  Total successful processed: ${processedSuccessCount}`);

      expect(processedSuccessCount).toBe(successEventCount);

      const em = orm.em.fork();
      const successEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'BenchmarkEvent',
      });
      expect(successEvents).toHaveLength(0);

      const failedEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'failed',
      });
      expect(failedEvents).toHaveLength(failingEventCount);
    });
  });
});
