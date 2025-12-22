import { vi, Mock } from 'vitest';
import { Logger } from '@nestjs/common';
import { DatabaseDriverFactory } from '../../driver/database-driver.factory';
import { DatabaseDriver } from '../../driver/database.driver';
import { TransactionalEventEmitter } from '../../emitter/transactional-event-emitter';
import { OutboxModuleOptions } from '../../outbox.module-definition';
import { RetryableOutboxEventPoller } from '../../poller/retryable-outbox-event.poller';
import { OutboxEventProcessorContract } from '../../processor/outbox-event-processor.contract';
import { EventConfigurationResolver } from '../../resolver/event-configuration.resolver';
import { createMockedDriverFactory } from './mock/driver-factory.mock';
import { createMockedDriver } from './mock/driver.mock';
import { createMockedOutboxOptionsFactory } from './mock/outbox-options.mock';

describe('RetryableOutboxEventPoller', () => {
  let mockedDriver: DatabaseDriver;
  let mockedDriverFactory: DatabaseDriverFactory;
  let outboxOptions: OutboxModuleOptions;
  let mockLogger: Logger;
  let mockTransactionalEventEmitter: TransactionalEventEmitter;
  let mockEventConfigurationResolver: EventConfigurationResolver;
  let mockOutboxEventProcessor: OutboxEventProcessorContract;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedDriver = createMockedDriver();
    mockedDriverFactory = createMockedDriverFactory(mockedDriver);
    outboxOptions = createMockedOutboxOptionsFactory(mockedDriverFactory, [
      {
        name: 'testEvent',
        listeners: {
          retentionPeriod: 1000,
          maxRetries: 5,
          maxExecutionTime: 1000,
        },
      },
    ]);
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockTransactionalEventEmitter = {
      getListeners: vi.fn().mockReturnValue([]),
    } as unknown as TransactionalEventEmitter;

    mockEventConfigurationResolver = {} as EventConfigurationResolver;

    mockOutboxEventProcessor = {
      process: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPoller() {
    return new RetryableOutboxEventPoller(
      outboxOptions,
      mockedDriverFactory,
      mockOutboxEventProcessor,
      mockTransactionalEventEmitter,
      mockEventConfigurationResolver,
      mockLogger,
    );
  }

  describe('onModuleDestroy', () => {
    it('should unsubscribe from interval on shutdown', async () => {
      const poller = createPoller();
      await poller.onModuleInit();

      await poller.onModuleDestroy();

      expect(mockLogger.log).toHaveBeenCalledWith('Shutting down RetryableOutboxEventPoller...');
      expect(mockLogger.log).toHaveBeenCalledWith('RetryableOutboxEventPoller shutdown complete.');
    });

    it('should stop polling after shutdown is initiated', async () => {
      (mockedDriver.findAndExtendReadyToRetryEvents as Mock).mockResolvedValue([]);
      const poller = createPoller();
      await poller.onModuleInit();

      vi.advanceTimersByTime(outboxOptions.pollingInterval);
      await Promise.resolve();

      const callCountBeforeShutdown = (mockedDriver.findAndExtendReadyToRetryEvents as Mock).mock.calls.length;

      await poller.onModuleDestroy();

      vi.advanceTimersByTime(outboxOptions.pollingInterval * 5);
      await Promise.resolve();

      const callCountAfterShutdown = (mockedDriver.findAndExtendReadyToRetryEvents as Mock).mock.calls.length;
      expect(callCountAfterShutdown).toBe(callCountBeforeShutdown);
    });

    it('should wait for in-flight processing to complete before shutdown', async () => {
      let resolveProcessing: () => void;
      const processingPromise = new Promise<void>((resolve) => {
        resolveProcessing = resolve;
      });

      (mockOutboxEventProcessor.process as Mock).mockReturnValue(processingPromise);

      const mockEvent = {
        id: 1,
        eventName: 'testEvent',
        eventPayload: {},
        deliveredToListeners: [],
        readyToRetryAfter: Date.now(),
        expireAt: Date.now() + 1000,
        insertedAt: Date.now(),
        retryCount: 0,
        status: 'pending' as const,
      };
      (mockedDriver.findAndExtendReadyToRetryEvents as Mock).mockResolvedValue([mockEvent]);

      const poller = createPoller();
      await poller.onModuleInit();

      vi.advanceTimersByTime(outboxOptions.pollingInterval);
      await Promise.resolve();
      await Promise.resolve();

      const shutdownPromise = poller.onModuleDestroy();

      expect(mockLogger.log).toHaveBeenCalledWith('Shutting down RetryableOutboxEventPoller...');
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Waiting for'));

      let shutdownCompleted = false;
      shutdownPromise.then(() => {
        shutdownCompleted = true;
      });

      await Promise.resolve();
      expect(shutdownCompleted).toBe(false);

      resolveProcessing!();
      await shutdownPromise;

      expect(mockLogger.log).toHaveBeenCalledWith('All in-flight events completed.');
      expect(mockLogger.log).toHaveBeenCalledWith('RetryableOutboxEventPoller shutdown complete.');
    });

    it('should handle shutdown when no in-flight processing exists', async () => {
      (mockedDriver.findAndExtendReadyToRetryEvents as Mock).mockResolvedValue([]);
      const poller = createPoller();
      await poller.onModuleInit();

      await poller.onModuleDestroy();

      expect(mockLogger.log).toHaveBeenCalledWith('Shutting down RetryableOutboxEventPoller...');
      expect(mockLogger.log).not.toHaveBeenCalledWith(expect.stringContaining('Waiting for'));
      expect(mockLogger.log).toHaveBeenCalledWith('RetryableOutboxEventPoller shutdown complete.');
    });

    it('should handle shutdown gracefully even if called before onModuleInit', async () => {
      const poller = createPoller();

      await poller.onModuleDestroy();

      expect(mockLogger.log).toHaveBeenCalledWith('Shutting down RetryableOutboxEventPoller...');
      expect(mockLogger.log).toHaveBeenCalledWith('RetryableOutboxEventPoller shutdown complete.');
    });
  });
});
