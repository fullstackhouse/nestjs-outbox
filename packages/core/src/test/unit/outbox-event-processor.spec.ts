import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { vi } from 'vitest';
import { DatabaseDriverFactory } from "../../driver/database-driver.factory";
import { DatabaseDriver } from "../../driver/database.driver";
import { isOutboxContext, OutboxHost, OUTBOX_CONTEXT_TYPE } from "../../filter/outbox-arguments-host";
import { OutboxModuleOptions } from "../../outbox.module-definition";
import { IListener } from "../../listener/contract/listener.interface";
import { OutboxMiddleware } from "../../middleware/outbox-middleware.interface";
import { OutboxTransportEvent } from "../../model/outbox-transport-event.interface";
import { OutboxEventProcessorContract } from "../../processor/outbox-event-processor.contract";
import { OutboxEventProcessor } from "../../processor/outbox-event.processor";
import { EventConfigurationResolverContract } from "../../resolver/event-configuration-resolver.contract";
import { createMockedDriverFactory } from "./mock/driver-factory.mock";
import { createMockedDriver } from "./mock/driver.mock";
import { createMockedEventConfigurationResolver } from "./mock/event-configuration-resolver.mock";
import { createMockedOutboxEventProcessor } from "./mock/outbox-event-processor.mock";
import { createMockedOutboxOptionsFactory } from "./mock/outbox-options.mock";

describe('OutboxEventProcessor', () => {

    let mockedDriver: DatabaseDriver;
    let mockedDriverFactory: DatabaseDriverFactory;
    let outboxOptions: OutboxModuleOptions;
    let mockedOutboxEventProcessor: OutboxEventProcessorContract;
    let mockedEventConfigurationResolver: EventConfigurationResolverContract;
    let mockLogger: any; 
    
    beforeEach(() => {
      mockedDriver = createMockedDriver();
      mockedDriverFactory = createMockedDriverFactory(mockedDriver);
      outboxOptions = createMockedOutboxOptionsFactory(mockedDriverFactory, []);
      mockedOutboxEventProcessor = createMockedOutboxEventProcessor();
      mockedEventConfigurationResolver = createMockedEventConfigurationResolver();
      mockLogger = {
        error: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
      }; 
    });

    it('Should process the event and deliver it to the all listeners, resulting in calling remove on driver', async () => {

        outboxOptions.events = [
            {
              name: 'newEvent',
              listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
              },
            },
          ];

        const firstListener : IListener<any> = {
            handle: vi.fn().mockReturnValue({}),
            getName: vi.fn().mockReturnValue('listener'),
        };

        const secondListener : IListener<any> = {
            handle: vi.fn().mockReturnValue({}),
            getName: vi.fn().mockReturnValue('listener'),
        };
        

        const outboxEventProcessor = new OutboxEventProcessor(
            mockLogger,
            mockedDriverFactory,
            mockedEventConfigurationResolver
        );

        const outboxTransportEvent : OutboxTransportEvent = {
            attemptAt: new Date().getTime(),
            deliveredToListeners: [],
            eventName: 'newEvent',
            eventPayload: {},
            expireAt: new Date().getTime() + 1000,
            id: 1,
            insertedAt: new Date().getTime(),
            retryCount: 0,
            status: 'pending',
        };

        await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [firstListener, secondListener]);

        
        expect(mockedDriver.remove).toHaveBeenCalledTimes(1);
        expect(mockedDriver.flush).toHaveBeenCalledTimes(1);

    });

    it('Should process the event and deliver it to the all listeners, one with error, resulting in calling in not calling remove on driver', async () => {

        outboxOptions.events = [
            {
              name: 'newEvent',
              listeners: {
                retentionPeriod: 1000,
                maxRetries: 5,
                maxExecutionTime: 1000,
              },
            },
          ];

        const firstListener : IListener<any> = {
            handle: vi.fn().mockReturnValue({}),
            getName: vi.fn().mockReturnValue('listener'),
        };

        const secondListener : IListener<any> = {
            handle: vi.fn().mockRejectedValue({}),
            getName: vi.fn().mockReturnValue('listener'),
        };
        

        const outboxEventProcessor = new OutboxEventProcessor(
            mockLogger,
            mockedDriverFactory,
            mockedEventConfigurationResolver
        );

        const outboxTransportEvent : OutboxTransportEvent = {
            attemptAt: new Date().getTime(),
            deliveredToListeners: [],
            eventName: 'newEvent',
            eventPayload: {},
            expireAt: new Date().getTime() + 1000,
            id: 1,
            insertedAt: new Date().getTime(),
            retryCount: 0,
            status: 'pending',
        };

        await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [firstListener, secondListener]);

        expect(mockedDriver.remove).not.toHaveBeenCalled();
        expect(mockedDriver.persist).toHaveBeenCalledTimes(1);
        expect(mockedDriver.flush).toHaveBeenCalledTimes(1);

    });

    describe('Middleware hooks', () => {
        it('Should call middleware beforeProcess and afterProcess hooks on successful processing', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const listener: IListener<any> = {
                handle: vi.fn().mockResolvedValue(undefined),
                getName: vi.fn().mockReturnValue('testListener'),
            };

            const middleware: OutboxMiddleware = {
                beforeProcess: vi.fn(),
                afterProcess: vi.fn(),
                onError: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [middleware]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: { test: 'data' },
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
                retryCount: 0,
                status: 'pending',
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(middleware.beforeProcess).toHaveBeenCalledTimes(1);
            expect(middleware.beforeProcess).toHaveBeenCalledWith({
                eventName: 'newEvent',
                eventPayload: { test: 'data' },
                eventId: 1,
                listenerName: 'testListener',
            });

            expect(middleware.afterProcess).toHaveBeenCalledTimes(1);
            expect(middleware.afterProcess).toHaveBeenCalledWith(
                {
                    eventName: 'newEvent',
                    eventPayload: { test: 'data' },
                    eventId: 1,
                    listenerName: 'testListener',
                },
                expect.objectContaining({
                    success: true,
                    durationMs: expect.any(Number),
                })
            );

            expect(middleware.onError).not.toHaveBeenCalled();
        });

        it('Should call middleware onError hook when listener throws', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const testError = new Error('Test error');
            const listener: IListener<any> = {
                handle: vi.fn().mockRejectedValue(testError),
                getName: vi.fn().mockReturnValue('failingListener'),
            };

            const middleware: OutboxMiddleware = {
                beforeProcess: vi.fn(),
                afterProcess: vi.fn(),
                onError: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [middleware]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(middleware.onError).toHaveBeenCalledTimes(1);
            expect(middleware.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: 'newEvent',
                    listenerName: 'failingListener',
                }),
                testError
            );

            expect(middleware.afterProcess).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    success: false,
                    error: testError,
                })
            );
        });

        it('Should call multiple middlewares in order', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const listener: IListener<any> = {
                handle: vi.fn().mockResolvedValue(undefined),
                getName: vi.fn().mockReturnValue('listener'),
            };

            const callOrder: string[] = [];
            const middleware1: OutboxMiddleware = {
                beforeProcess: vi.fn().mockImplementation(() => callOrder.push('before1')),
                afterProcess: vi.fn().mockImplementation(() => callOrder.push('after1')),
            };
            const middleware2: OutboxMiddleware = {
                beforeProcess: vi.fn().mockImplementation(() => callOrder.push('before2')),
                afterProcess: vi.fn().mockImplementation(() => callOrder.push('after2')),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [middleware1, middleware2]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(callOrder).toEqual(['before1', 'before2', 'after1', 'after2']);
        });

        it('Should continue processing if middleware throws', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const listener: IListener<any> = {
                handle: vi.fn().mockResolvedValue(undefined),
                getName: vi.fn().mockReturnValue('listener'),
            };

            const failingMiddleware: OutboxMiddleware = {
                beforeProcess: vi.fn().mockRejectedValue(new Error('Middleware error')),
                afterProcess: vi.fn(),
            };
            const successMiddleware: OutboxMiddleware = {
                beforeProcess: vi.fn(),
                afterProcess: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [failingMiddleware, successMiddleware]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(listener.handle).toHaveBeenCalled();
            expect(successMiddleware.beforeProcess).toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('Should provide duration in afterProcess result', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const listener: IListener<any> = {
                handle: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 50))),
                getName: vi.fn().mockReturnValue('slowListener'),
            };

            const middleware: OutboxMiddleware = {
                afterProcess: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [middleware]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(middleware.afterProcess).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    success: true,
                    durationMs: expect.any(Number),
                })
            );

            const result = (middleware.afterProcess as ReturnType<typeof vi.fn>).mock.calls[0][1];
            expect(result.durationMs).toBeGreaterThanOrEqual(40);
        });
    });

    describe('Exception filters', () => {
        it('Should call exception filter with ArgumentsHost when listener throws', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const testError = new Error('Test error');
            const listener: IListener<any> = {
                handle: vi.fn().mockRejectedValue(testError),
                getName: vi.fn().mockReturnValue('failingListener'),
            };

            let capturedHost: ArgumentsHost | null = null;
            const exceptionFilter: ExceptionFilter = {
                catch: vi.fn().mockImplementation((_err, host) => {
                    capturedHost = host;
                }),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [],
                [exceptionFilter]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: { test: 'data' },
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
                retryCount: 0,
                status: 'pending',
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(exceptionFilter.catch).toHaveBeenCalledTimes(1);
            expect(exceptionFilter.catch).toHaveBeenCalledWith(testError, expect.any(OutboxHost));

            expect(capturedHost).not.toBeNull();
            expect(capturedHost!.getType()).toBe(OUTBOX_CONTEXT_TYPE);
            expect(isOutboxContext(capturedHost!)).toBe(true);

            const outboxHost = capturedHost as OutboxHost;
            const context = outboxHost.switchToOutbox().getContext();
            expect(context).toEqual({
                eventName: 'newEvent',
                eventPayload: { test: 'data' },
                eventId: 1,
                listenerName: 'failingListener',
            });
        });

        it('Should not call exception filter on successful processing', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const listener: IListener<any> = {
                handle: vi.fn().mockResolvedValue(undefined),
                getName: vi.fn().mockReturnValue('successListener'),
            };

            const exceptionFilter: ExceptionFilter = {
                catch: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [],
                [exceptionFilter]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(exceptionFilter.catch).not.toHaveBeenCalled();
        });

        it('Should call multiple exception filters in order', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const testError = new Error('Test error');
            const listener: IListener<any> = {
                handle: vi.fn().mockRejectedValue(testError),
                getName: vi.fn().mockReturnValue('failingListener'),
            };

            const callOrder: string[] = [];
            const filter1: ExceptionFilter = {
                catch: vi.fn().mockImplementation(() => callOrder.push('filter1')),
            };
            const filter2: ExceptionFilter = {
                catch: vi.fn().mockImplementation(() => callOrder.push('filter2')),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [],
                [filter1, filter2]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(callOrder).toEqual(['filter1', 'filter2']);
        });

        it('Should log error and continue when exception filter throws', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const testError = new Error('Listener error');
            const listener: IListener<any> = {
                handle: vi.fn().mockRejectedValue(testError),
                getName: vi.fn().mockReturnValue('failingListener'),
            };

            const filterError = new Error('Filter error');
            const failingFilter: ExceptionFilter = {
                catch: vi.fn().mockRejectedValue(filterError),
            };
            const successFilter: ExceptionFilter = {
                catch: vi.fn(),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [],
                [failingFilter, successFilter]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(failingFilter.catch).toHaveBeenCalled();
            expect(successFilter.catch).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(testError);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Exception filter failed'),
                expect.any(String)
            );
        });

        it('Should call exception filters after onError middleware hooks', async () => {
            outboxOptions.events = [
                {
                    name: 'newEvent',
                    listeners: {
                        retentionPeriod: 1000,
                        maxRetries: 5,
                        maxExecutionTime: 1000,
                    },
                },
            ];

            const testError = new Error('Test error');
            const listener: IListener<any> = {
                handle: vi.fn().mockRejectedValue(testError),
                getName: vi.fn().mockReturnValue('failingListener'),
            };

            const callOrder: string[] = [];
            const middleware: OutboxMiddleware = {
                onError: vi.fn().mockImplementation(() => callOrder.push('middleware.onError')),
            };
            const exceptionFilter: ExceptionFilter = {
                catch: vi.fn().mockImplementation(() => callOrder.push('exceptionFilter.catch')),
            };

            const outboxEventProcessor = new OutboxEventProcessor(
                mockLogger,
                mockedDriverFactory,
                mockedEventConfigurationResolver,
                [middleware],
                [exceptionFilter]
            );

            const outboxTransportEvent: OutboxTransportEvent = {
                attemptAt: new Date().getTime(),
                deliveredToListeners: [],
                eventName: 'newEvent',
                eventPayload: {},
                expireAt: new Date().getTime() + 1000,
                id: 1,
                insertedAt: new Date().getTime(),
            };

            await outboxEventProcessor.process(outboxOptions.events[0], outboxTransportEvent, [listener]);

            expect(callOrder).toEqual(['middleware.onError', 'exceptionFilter.catch']);
        });

        it('Should throw when switching to HTTP/RPC/WS context from OutboxHost', () => {
            const context = {
                eventName: 'test',
                eventPayload: {},
                eventId: 1,
                listenerName: 'testListener',
            };
            const host = new OutboxHost(context);

            expect(() => host.switchToHttp()).toThrow('Cannot switch to HTTP context from outbox context');
            expect(() => host.switchToRpc()).toThrow('Cannot switch to RPC context from outbox context');
            expect(() => host.switchToWs()).toThrow('Cannot switch to WebSocket context from outbox context');
        });

        it('Should provide args via getArgs and getArgByIndex', () => {
            const context = {
                eventName: 'test',
                eventPayload: { foo: 'bar' },
                eventId: 42,
                listenerName: 'testListener',
            };
            const host = new OutboxHost(context);

            expect(host.getArgs()).toEqual([context]);
            expect(host.getArgByIndex(0)).toBe(context);
        });
    });
});