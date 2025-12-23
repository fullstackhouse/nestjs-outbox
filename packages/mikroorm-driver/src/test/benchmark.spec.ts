import 'reflect-metadata';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/core';
import {
  TransactionalEventEmitter,
  OutboxEvent,
  IListener,
} from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';
import { createTestApp, cleanupTestApp, TestContext } from './test-utils';
import { benchmarkReporter } from './benchmark-reporter';

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

async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 100,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('Outbox Benchmark Tests (PostgreSQL)', () => {
  let context: TestContext;

  afterEach(async () => {
    if (context) {
      await cleanupTestApp(context);
    }
  });

  afterAll(async () => {
    if (process.env.BENCHMARK_OUTPUT_PATH) {
      await benchmarkReporter.saveReport();
    }
  });

  describe('Parallel Event Emission', () => {
    it('should handle many events emitted in parallel', async () => {
      const eventCount = 100;
      const listenerCount = 3;
      let processedCount = 0;

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
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      for (let i = 0; i < listenerCount; i++) {
        emitter.addListener('BenchmarkEvent', {
          getName: () => `Listener${i}`,
          handle: async () => {
            processedCount++;
          },
        });
      }

      const emitStartTime = performance.now();

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      const emitEndTime = performance.now();
      const emitDurationMs = emitEndTime - emitStartTime;

      const processStartTime = performance.now();

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const remaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
        });
        return remaining === 0;
      }, 30000);

      const processEndTime = performance.now();
      const processDurationMs = processEndTime - processStartTime;

      const emitEventsPerSecond = (eventCount / emitDurationMs) * 1000;
      const processEventsPerSecond = (eventCount / processDurationMs) * 1000;

      console.log(`[Parallel Event Emission] ${eventCount} events with ${listenerCount} listeners`);
      console.log(`  Emit duration: ${emitDurationMs.toFixed(2)}ms`);
      console.log(`  Process duration: ${processDurationMs.toFixed(2)}ms`);
      console.log(`  Events per second (emit): ${emitEventsPerSecond.toFixed(2)}`);
      console.log(`  Events per second (process): ${processEventsPerSecond.toFixed(2)}`);
      console.log(`  Total listener calls: ${processedCount}`);

      benchmarkReporter.record('Parallel Event Emission', {
        durationMs: processDurationMs,
        eventsPerSecond: processEventsPerSecond,
        eventCount,
        listenerCount,
        totalListenerCalls: processedCount,
        emitDurationMs,
        emitEventsPerSecond,
      });

      expect(processedCount).toBe(eventCount * listenerCount);
    });

    it('should handle sequential batch emission', async () => {
      const batchCount = 10;
      const eventsPerBatch = 50;
      const totalEvents = batchCount * eventsPerBatch;
      let processedCount = 0;

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
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'BatchListener',
        handle: async () => {
          processedCount++;
        },
      });

      const emitStartTime = performance.now();

      for (let batch = 0; batch < batchCount; batch++) {
        await Promise.all(
          Array.from({ length: eventsPerBatch }, (_, i) =>
            emitter.emit(new BenchmarkEvent(batch * eventsPerBatch + i, `batch-${batch}-event-${i}`))
          )
        );
      }

      const emitEndTime = performance.now();

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const remaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
        });
        return remaining === 0;
      }, 30000);

      const processEndTime = performance.now();

      const emitDurationMs = emitEndTime - emitStartTime;
      const totalDurationMs = processEndTime - emitStartTime;

      console.log(`[Sequential Batch Emission] ${batchCount} batches of ${eventsPerBatch} events`);
      console.log(`  Total events: ${totalEvents}`);
      console.log(`  Emit duration: ${emitDurationMs.toFixed(2)}ms`);
      console.log(`  Total duration (including processing): ${totalDurationMs.toFixed(2)}ms`);
      console.log(`  Avg time per batch: ${(emitDurationMs / batchCount).toFixed(2)}ms`);

      benchmarkReporter.record('Sequential Batch Emission', {
        durationMs: totalDurationMs,
        eventsPerSecond: (totalEvents / totalDurationMs) * 1000,
        eventCount: totalEvents,
        batchCount,
        eventsPerBatch,
        emitDurationMs,
      });

      expect(processedCount).toBe(totalEvents);
    });
  });

  describe('Parallel Event Processing', () => {
    it('should handle many events processed in parallel with multiple listeners', async () => {
      const eventCount = 100;
      const listenerCount = 5;
      const handledCounts: number[] = Array(listenerCount).fill(0);

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
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      for (let i = 0; i < listenerCount; i++) {
        const listenerIndex = i;
        const listener: IListener<BenchmarkEvent> = {
          getName: () => `BenchmarkListener${listenerIndex}`,
          handle: async () => {
            handledCounts[listenerIndex]++;
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

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const remaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
        });
        return remaining === 0;
      }, 30000);

      const endTime = performance.now();
      const durationMs = endTime - startTime;

      const eventsPerSecond = (eventCount / durationMs) * 1000;

      console.log(`[Parallel Event Processing] ${eventCount} events with ${listenerCount} listeners`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Events per second: ${eventsPerSecond.toFixed(2)}`);
      console.log(`  Avg time per event: ${(durationMs / eventCount).toFixed(2)}ms`);

      benchmarkReporter.record('Parallel Event Processing', {
        durationMs,
        eventsPerSecond,
        eventCount,
        listenerCount,
        avgTimePerEventMs: durationMs / eventCount,
      });

      for (let i = 0; i < listenerCount; i++) {
        expect(handledCounts[i]).toBe(eventCount);
      }
    });

    it('should maintain correctness under high concurrency', async () => {
      const eventCount = 50;
      const listenerCount = 10;
      const processedEventIds = new Set<number>();
      const listenerCalls: Map<string, number[]> = new Map();

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
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

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

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const remaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
        });
        return remaining === 0;
      }, 30000);

      expect(processedEventIds.size).toBe(eventCount);

      for (const [, ids] of listenerCalls) {
        expect(ids.length).toBe(eventCount);
      }
    });
  });

  describe('DLQ Events Handling', () => {
    it('should handle many DLQ events efficiently', async () => {
      const dlqEventCount = 50;
      const maxRetries = 2;
      let failureCount = 0;

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries,
              maxExecutionTime: 30000,
              retryStrategy: () => 10,
            },
          },
        ],
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      emitter.addListener('RetryableEvent', {
        getName: () => 'AlwaysFailingListener',
        handle: async () => {
          failureCount++;
          throw new Error('Always fails');
        },
      });

      const startTime = performance.now();

      await Promise.all(
        Array.from({ length: dlqEventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, true))
        )
      );

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const failedCount = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'failed',
        });
        return failedCount === dlqEventCount;
      }, 30000);

      const endTime = performance.now();
      const durationMs = endTime - startTime;

      console.log(`[DLQ Events Handling] ${dlqEventCount} events failed after ${maxRetries} retries`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Total failure attempts: ${failureCount}`);
      console.log(`  Avg failures per event: ${(failureCount / dlqEventCount).toFixed(2)}`);

      benchmarkReporter.record('DLQ Events Handling', {
        durationMs,
        eventsPerSecond: (dlqEventCount / durationMs) * 1000,
        eventCount: dlqEventCount,
        maxRetries,
        totalFailureAttempts: failureCount,
        avgFailuresPerEvent: failureCount / dlqEventCount,
      });

      const em = orm.em.fork();
      const failedEvents = await em.find(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'failed',
      });

      expect(failedEvents.length).toBe(dlqEventCount);
    });

    it('should continue processing when some handlers fail', async () => {
      const eventCount = 30;
      const successCount = eventCount / 2;
      const failCount = eventCount / 2;
      let successfulCalls = 0;
      let failedCalls = 0;

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 0,
              maxRetries: 2, // Need retryCount < maxRetries to get pendingEvents
              maxExecutionTime: 30000,
              retryStrategy: () => 10,
            },
          },
        ],
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      const listener = {
        getName: () => 'ConditionalListener',
        handle: async (event: RetryableEvent) => {
          if (event.shouldFail) {
            failedCalls++;
            throw new Error('Intentional failure');
          }
          successfulCalls++;
        },
      };
      emitter.addListener('RetryableEvent', listener);

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, i % 2 === 0))
        )
      );

      // Wait for all events to be processed
      // Successful events are deleted (retentionPeriod=0)
      // Failed events go to 'failed' status after maxRetries attempts
      await waitForCondition(async () => {
        const em = orm.em.fork();
        const failedCount = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'failed',
        });
        const pendingCount = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'pending',
        });
        return failedCount === failCount && pendingCount === 0 && successfulCalls === successCount;
      }, 30000);

      expect(successfulCalls).toBe(successCount);
      // Failed calls can be >= failCount due to retry attempts
      expect(failedCalls).toBeGreaterThanOrEqual(failCount);

      const em = orm.em.fork();
      const failedEvents = await em.count(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'failed',
      });
      expect(failedEvents).toBe(failCount);
    });
  });

  describe('Event Retries', () => {
    it('should handle many retried events efficiently', async () => {
      const eventCount = 30;
      const maxRetries = 3;
      const attemptCounts: Map<number, number> = new Map();

      context = await createTestApp({
        events: [
          {
            name: 'RetryableEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries,
              maxExecutionTime: 30000,
              retryStrategy: () => 10,
            },
          },
        ],
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

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

      const startTime = performance.now();

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new RetryableEvent(i, false))
        )
      );

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const remaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
        });
        return remaining === 0;
      }, 30000);

      const endTime = performance.now();
      const durationMs = endTime - startTime;

      console.log(`[Event Retries] ${eventCount} events with up to ${maxRetries} retries`);
      console.log(`  Total duration: ${durationMs.toFixed(2)}ms`);
      console.log(`  Avg time per event (including retries): ${(durationMs / eventCount).toFixed(2)}ms`);

      benchmarkReporter.record('Event Retries', {
        durationMs,
        eventsPerSecond: (eventCount / durationMs) * 1000,
        eventCount,
        maxRetries,
        avgTimePerEventMs: durationMs / eventCount,
      });

      for (const [, count] of attemptCounts) {
        expect(count).toBe(2);
      }
    });

    it('should track partial delivery correctly during retries', async () => {
      const eventCount = 20;
      const maxRetries = 3;
      let successCount = 0;
      let failCount = 0;

      context = await createTestApp({
        events: [
          {
            name: 'BenchmarkEvent',
            listeners: {
              retentionPeriod: 60000,
              maxRetries,
              maxExecutionTime: 30000,
              retryStrategy: () => 10,
            },
          },
        ],
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
      const orm = context.orm;

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'AlwaysSucceedsListener',
        handle: async () => {
          successCount++;
        },
      });

      emitter.addListener('BenchmarkEvent', {
        getName: () => 'AlwaysFailsListener',
        handle: async () => {
          failCount++;
          throw new Error('Always fails');
        },
      });

      await Promise.all(
        Array.from({ length: eventCount }, (_, i) =>
          emitter.emit(new BenchmarkEvent(i, `payload-${i}`))
        )
      );

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const failedCount = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
          status: 'failed',
        });
        return failedCount === eventCount;
      }, 30000);

      const em = orm.em.fork();
      const events = await em.find(MikroOrmOutboxTransportEvent, { eventName: 'BenchmarkEvent' });

      expect(events.length).toBe(eventCount);
      expect(successCount).toBe(eventCount);
      // Failing listener is called on initial attempt + maxRetries attempts
      expect(failCount).toBeGreaterThanOrEqual(eventCount);

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
      let failingAttempts = 0;
      const maxRetriesForFailing = 2;

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
              retryStrategy: () => 10,
            },
          },
        ],
        pollingInterval: 50,
        maxEventsPerPoll: 1000,
      });

      const emitter = context.module.get(TransactionalEventEmitter);
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
          failingAttempts++;
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

      await waitForCondition(async () => {
        const em = orm.em.fork();
        const successRemaining = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'BenchmarkEvent',
        });
        const failedCount = await em.count(MikroOrmOutboxTransportEvent, {
          eventName: 'RetryableEvent',
          status: 'failed',
        });
        return successRemaining === 0 && failedCount === failingEventCount;
      }, 30000);

      const processEndTime = performance.now();

      const emitDurationMs = emitEndTime - emitStartTime;
      const processDurationMs = processEndTime - processStartTime;
      const totalEvents = successEventCount + failingEventCount;

      console.log(`[Combined Load Test] ${successEventCount} success + ${failingEventCount} failing events`);
      console.log(`  Emit duration: ${emitDurationMs.toFixed(2)}ms`);
      console.log(`  Process duration: ${processDurationMs.toFixed(2)}ms`);
      console.log(`  Total successful processed: ${processedSuccessCount}`);
      console.log(`  Total failing attempts: ${failingAttempts}`);

      benchmarkReporter.record('Combined Load Test', {
        durationMs: processDurationMs,
        eventsPerSecond: (totalEvents / processDurationMs) * 1000,
        eventCount: totalEvents,
        successEventCount,
        failingEventCount,
        emitDurationMs,
        processedSuccessCount,
        failingAttempts,
      });

      expect(processedSuccessCount).toBe(successEventCount);
      // Failing events should have been attempted at least once (could be more with retries)
      expect(failingAttempts).toBeGreaterThanOrEqual(failingEventCount);

      const em = orm.em.fork();
      const successEvents = await em.count(MikroOrmOutboxTransportEvent, {
        eventName: 'BenchmarkEvent',
      });
      expect(successEvents).toBe(0);

      const failedEvents = await em.count(MikroOrmOutboxTransportEvent, {
        eventName: 'RetryableEvent',
        status: 'failed',
      });
      expect(failedEvents).toBe(failingEventCount);
    });
  });
});
