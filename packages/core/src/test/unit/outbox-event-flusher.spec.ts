import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DatabaseDriverFactory } from '../../driver/database-driver.factory';
import { DatabaseDriver } from '../../driver/database.driver';
import { OutboxEventFlusher } from '../../flusher/outbox-event-flusher';
import { IListener } from '../../listener/contract/listener.interface';
import { OutboxTransportEvent } from '../../model/outbox-transport-event.interface';
import { OutboxEventProcessorContract } from '../../processor/outbox-event-processor.contract';
import { EventConfigurationResolverContract } from '../../resolver/event-configuration-resolver.contract';
import { TransactionalEventEmitter } from '../../emitter/transactional-event-emitter';
import { createMockedDriverFactory } from './mock/driver-factory.mock';
import { createMockedDriver } from './mock/driver.mock';
import { createMockedEventConfigurationResolver } from './mock/event-configuration-resolver.mock';
import { createMockedOutboxEventProcessor } from './mock/outbox-event-processor.mock';

describe('OutboxEventFlusher', () => {
    let mockedDriver: DatabaseDriver;
    let mockedDriverFactory: DatabaseDriverFactory;
    let mockedOutboxEventProcessor: OutboxEventProcessorContract;
    let mockedEventConfigurationResolver: EventConfigurationResolverContract;
    let mockedTransactionalEventEmitter: TransactionalEventEmitter;
    let flusher: OutboxEventFlusher;

    beforeEach(() => {
        mockedDriver = createMockedDriver();
        mockedDriverFactory = createMockedDriverFactory(mockedDriver);
        mockedOutboxEventProcessor = createMockedOutboxEventProcessor();
        mockedEventConfigurationResolver = createMockedEventConfigurationResolver();
        mockedTransactionalEventEmitter = {
            getListeners: vi.fn().mockReturnValue([]),
        } as unknown as TransactionalEventEmitter;

        flusher = new OutboxEventFlusher(
            mockedDriverFactory,
            mockedOutboxEventProcessor,
            mockedEventConfigurationResolver,
            mockedTransactionalEventEmitter,
        );
    });

    it('should return zero counts when no pending events exist', async () => {
        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await flusher.processAllPendingEvents();

        expect(result).toEqual({ processedCount: 0, failedCount: 0 });
        expect(mockedDriver.findPendingEvents).toHaveBeenCalledWith(1000);
    });

    it('should process pending events and return processed count', async () => {
        const pendingEvents: OutboxTransportEvent[] = [
            {
                id: 1,
                eventName: 'TestEvent',
                eventPayload: { data: 'test' },
                deliveredToListeners: [],
                attemptAt: Date.now(),
                expireAt: Date.now() + 1000,
                insertedAt: Date.now(),
                retryCount: 0,
                status: 'pending',
            },
            {
                id: 2,
                eventName: 'TestEvent',
                eventPayload: { data: 'test2' },
                deliveredToListeners: [],
                attemptAt: Date.now(),
                expireAt: Date.now() + 1000,
                insertedAt: Date.now(),
                retryCount: 0,
                status: 'pending',
            },
        ];

        const eventConfig = {
            name: 'TestEvent',
            listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
            },
        };

        const listener: IListener<any> = {
            handle: vi.fn(),
            getName: vi.fn().mockReturnValue('testListener'),
        };

        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue(pendingEvents);
        (mockedEventConfigurationResolver.resolve as ReturnType<typeof vi.fn>).mockReturnValue(eventConfig);
        (mockedTransactionalEventEmitter.getListeners as ReturnType<typeof vi.fn>).mockReturnValue([listener]);
        (mockedOutboxEventProcessor.process as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const result = await flusher.processAllPendingEvents();

        expect(result).toEqual({ processedCount: 2, failedCount: 0 });
        expect(mockedOutboxEventProcessor.process).toHaveBeenCalledTimes(2);
        expect(mockedOutboxEventProcessor.process).toHaveBeenCalledWith(eventConfig, pendingEvents[0], [listener]);
        expect(mockedOutboxEventProcessor.process).toHaveBeenCalledWith(eventConfig, pendingEvents[1], [listener]);
    });

    it('should count failed events when processor throws', async () => {
        const listener: IListener<any> = {
            handle: vi.fn(),
            getName: vi.fn().mockReturnValue('testListener'),
        };

        const pendingEvents: OutboxTransportEvent[] = [
            {
                id: 1,
                eventName: 'TestEvent',
                eventPayload: {},
                deliveredToListeners: [],
                attemptAt: Date.now(),
                expireAt: Date.now() + 1000,
                insertedAt: Date.now(),
                retryCount: 0,
                status: 'pending',
            },
            {
                id: 2,
                eventName: 'TestEvent',
                eventPayload: {},
                deliveredToListeners: [],
                attemptAt: Date.now(),
                expireAt: Date.now() + 1000,
                insertedAt: Date.now(),
                retryCount: 0,
                status: 'pending',
            },
        ];

        const eventConfig = {
            name: 'TestEvent',
            listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
            },
        };

        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue(pendingEvents);
        (mockedEventConfigurationResolver.resolve as ReturnType<typeof vi.fn>).mockReturnValue(eventConfig);
        (mockedTransactionalEventEmitter.getListeners as ReturnType<typeof vi.fn>).mockReturnValue([listener]);
        (mockedOutboxEventProcessor.process as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('Processing failed'));

        const result = await flusher.processAllPendingEvents();

        expect(result).toEqual({ processedCount: 1, failedCount: 1 });
    });

    it('should only process listeners not yet delivered to', async () => {
        const listener1: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('listener1') };
        const listener2: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('listener2') };
        const listener3: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('listener3') };

        const eventWithPartialDelivery: OutboxTransportEvent = {
            id: 1,
            eventName: 'TestEvent',
            eventPayload: {},
            deliveredToListeners: ['listener1'],
            attemptAt: Date.now(),
            expireAt: Date.now() + 1000,
            insertedAt: Date.now(),
            retryCount: 0,
            status: 'pending',
        };

        const eventConfig = {
            name: 'TestEvent',
            listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
            },
        };

        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue([eventWithPartialDelivery]);
        (mockedEventConfigurationResolver.resolve as ReturnType<typeof vi.fn>).mockReturnValue(eventConfig);
        (mockedTransactionalEventEmitter.getListeners as ReturnType<typeof vi.fn>).mockReturnValue([listener1, listener2, listener3]);
        (mockedOutboxEventProcessor.process as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await flusher.processAllPendingEvents();

        expect(mockedOutboxEventProcessor.process).toHaveBeenCalledWith(
            eventConfig,
            eventWithPartialDelivery,
            [listener2, listener3]
        );
    });

    it('should skip events where all listeners have been delivered to', async () => {
        const listener: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('listener1') };

        const fullyDeliveredEvent: OutboxTransportEvent = {
            id: 1,
            eventName: 'TestEvent',
            eventPayload: {},
            deliveredToListeners: ['listener1'],
            attemptAt: Date.now(),
            expireAt: Date.now() + 1000,
            insertedAt: Date.now(),
            retryCount: 0,
            status: 'pending',
        };

        const eventConfig = {
            name: 'TestEvent',
            listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
            },
        };

        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue([fullyDeliveredEvent]);
        (mockedEventConfigurationResolver.resolve as ReturnType<typeof vi.fn>).mockReturnValue(eventConfig);
        (mockedTransactionalEventEmitter.getListeners as ReturnType<typeof vi.fn>).mockReturnValue([listener]);

        const result = await flusher.processAllPendingEvents();

        expect(mockedOutboxEventProcessor.process).not.toHaveBeenCalled();
        expect(result).toEqual({ processedCount: 0, failedCount: 0 });
    });

    it('should use custom limit when provided', async () => {
        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        await flusher.processAllPendingEvents(50);

        expect(mockedDriver.findPendingEvents).toHaveBeenCalledWith(50);
    });

    it('should get listeners from TransactionalEventEmitter for each event', async () => {
        const event1: OutboxTransportEvent = {
            id: 1,
            eventName: 'Event1',
            eventPayload: {},
            deliveredToListeners: [],
            attemptAt: Date.now(),
            expireAt: Date.now() + 1000,
            insertedAt: Date.now(),
            retryCount: 0,
            status: 'pending',
        };
        const event2: OutboxTransportEvent = {
            id: 2,
            eventName: 'Event2',
            eventPayload: {},
            deliveredToListeners: [],
            attemptAt: Date.now(),
            expireAt: Date.now() + 1000,
            insertedAt: Date.now(),
            retryCount: 0,
            status: 'pending',
        };

        const listener1: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('l1') };
        const listener2: IListener<any> = { handle: vi.fn(), getName: vi.fn().mockReturnValue('l2') };

        (mockedDriver.findPendingEvents as ReturnType<typeof vi.fn>).mockResolvedValue([event1, event2]);
        (mockedEventConfigurationResolver.resolve as ReturnType<typeof vi.fn>).mockReturnValue({
            name: 'test',
            listeners: { retentionPeriod: 1000, maxRetries: 5, maxExecutionTime: 1000 },
        });
        (mockedTransactionalEventEmitter.getListeners as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce([listener1])
            .mockReturnValueOnce([listener2]);
        (mockedOutboxEventProcessor.process as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await flusher.processAllPendingEvents();

        expect(mockedTransactionalEventEmitter.getListeners).toHaveBeenCalledWith('Event1');
        expect(mockedTransactionalEventEmitter.getListeners).toHaveBeenCalledWith('Event2');
        expect(mockedOutboxEventProcessor.process).toHaveBeenNthCalledWith(1, expect.anything(), event1, [listener1]);
        expect(mockedOutboxEventProcessor.process).toHaveBeenNthCalledWith(2, expect.anything(), event2, [listener2]);
    });
});
