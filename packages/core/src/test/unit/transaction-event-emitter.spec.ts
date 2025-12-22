import { DatabaseDriverFactory } from '../../driver/database-driver.factory';
import { DatabaseDriver } from '../../driver/database.driver';
import { TransactionalEventEmitter, TransactionalEventEmitterOperations } from '../../emitter/transactional-event-emitter';
import { OutboxModuleOptions } from '../../outbox.module-definition';
import { IListener } from '../../listener/contract/listener.interface';
import { OutboxMiddleware } from '../../middleware/outbox-middleware.interface';
import { EventConfigurationResolverContract } from '../../resolver/event-configuration-resolver.contract';
import { createMockedDriverFactory } from './mock/driver-factory.mock';
import { createMockedDriver } from './mock/driver.mock';
import { createMockedEventConfigurationResolver } from './mock/event-configuration-resolver.mock';
import { createMockedOutboxOptionsFactory } from './mock/outbox-options.mock';

describe('TransacationalEventEmitter', () => {

  let mockedDriver: DatabaseDriver;
  let mockedDriverFactory: DatabaseDriverFactory;
  let outboxOptions: OutboxModuleOptions;
  let mockedEventConfigurationResolver: EventConfigurationResolverContract;

  beforeEach(() => {
    mockedDriver = createMockedDriver();
    mockedDriverFactory = createMockedDriverFactory(mockedDriver);
    outboxOptions = createMockedOutboxOptionsFactory(mockedDriverFactory, []);
    mockedEventConfigurationResolver = createMockedEventConfigurationResolver();
  });

  it('Should call persist 2 times and flush', async () => {

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

    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const newEvent = {
      name: 'newEvent',
    };

    const newEntityToSave = {
      id: null,
    };

    await transactionalEventEmitter.emit(newEvent, [
      {
        entity: newEntityToSave,
        operation: TransactionalEventEmitterOperations.persist,
      },
    ]);

    expect(mockedDriver.persist).toHaveBeenCalledWith(newEntityToSave);
    expect(mockedDriver.persist).toHaveBeenCalledTimes(2);
    expect(mockedDriver.flush).toHaveBeenCalled();
  });

  it('Should call remove 1 times and flush', async () => {

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

    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const newEvent = {
      name: 'newEvent',
    };

    const newEntityToRemove = {
      id: null,
    };

    await transactionalEventEmitter.emit(newEvent, [
      {
        entity: newEntityToRemove,
        operation: TransactionalEventEmitterOperations.remove,
      },
    ]);

    expect(mockedDriver.remove).toHaveBeenCalledWith(newEntityToRemove);
    expect(mockedDriver.remove).toHaveBeenCalledTimes(1);
    expect(mockedDriver.flush).toHaveBeenCalled();
  });

  it('Should call persist 3 times and flush', async () => {

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

    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const newEvent = {
      name: 'newEvent',
    };

    const newEntityToSave = {
      id: null,
    };

    await transactionalEventEmitter.emit(newEvent, [
      {
        entity: newEntityToSave,
        operation: TransactionalEventEmitterOperations.persist,
      },
      {
        entity: newEntityToSave,
        operation: TransactionalEventEmitterOperations.persist,
      },
    ]);

    expect(mockedDriver.persist).toHaveBeenCalledTimes(3);
    expect(mockedDriver.flush).toHaveBeenCalled();
  });

  it('Should call persist 1 times and flush', async () => {

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

    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const newEvent = {
      name: 'newEvent',
    };

    await transactionalEventEmitter.emit(newEvent);

    expect(mockedDriver.persist).toHaveBeenCalledTimes(1);
    expect(mockedDriver.flush).toHaveBeenCalled();
  });

  it('Should throw an error when event is not configured', async () => {
    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const newEvent = {
      name: 'notConfiguredEvent',
    };

    await expect(transactionalEventEmitter.emit(newEvent)).rejects.toThrow(`Event ${newEvent.name} is not configured. Did you forget to add it to the module options?`);
  })


  it('Should throw an error when listener has duplicate name', async () => {
    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const listener : IListener<any> = {
      getName: () => {
        return 'listenerName';
      },
      handle: async () => {
        return;
      }
    };

    transactionalEventEmitter.addListener('eventName', listener);

    expect(() => transactionalEventEmitter.addListener('eventName', listener)).toThrow(`Listener ${listener.getName()} is already registered`);
  });

  it('Should add listener', async () => {
    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const listener : IListener<any> = {
      getName: () => {
        return 'listenerName';
      },
      handle: async () => {
        return;
      }
    };

    transactionalEventEmitter.addListener('eventName', listener);

    expect(transactionalEventEmitter.getListeners('eventName')).toContain(listener);
  });


  it('Should remove listener', async () => {
    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const listener : IListener<any> = {
      getName: () => {
        return 'listenerName';
      },
      handle: async () => {
        return;
      }
    };

    transactionalEventEmitter.addListener('eventName', listener);

    transactionalEventEmitter.removeListeners('eventName');

    expect(transactionalEventEmitter.getListeners('eventName')).toEqual([]);
  })

  it('Should get event names', async () => {
    const transactionalEventEmitter = new TransactionalEventEmitter(outboxOptions, mockedDriverFactory, mockedEventConfigurationResolver);

    const listener : IListener<any> = {
      getName: () => {
        return 'listenerName';
      },
      handle: async () => {
        return;
      }
    };

    transactionalEventEmitter.addListener('eventName', listener);

    expect(transactionalEventEmitter.getEventNames()).toContain('eventName');
  })

  describe('beforeEmit middleware', () => {
    it('Should apply beforeEmit middleware before persisting event', async () => {
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

      const middleware: OutboxMiddleware = {
        beforeEmit: vi.fn((event) => ({
          ...event,
          injectedField: 'injectedValue',
        })),
      };

      const transactionalEventEmitter = new TransactionalEventEmitter(
        outboxOptions,
        mockedDriverFactory,
        mockedEventConfigurationResolver,
        [middleware],
      );

      const newEvent = { name: 'newEvent' };
      await transactionalEventEmitter.emit(newEvent);

      expect(middleware.beforeEmit).toHaveBeenCalledWith(newEvent);
      expect(mockedDriver.createOutboxTransportEvent).toHaveBeenCalledWith(
        'newEvent',
        { name: 'newEvent', injectedField: 'injectedValue' },
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('Should apply multiple middlewares with beforeEmit in order', async () => {
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

      const callOrder: string[] = [];

      const middleware1: OutboxMiddleware = {
        beforeEmit: vi.fn((event) => {
          callOrder.push('middleware1');
          return { ...event, field1: 'value1' };
        }),
      };

      const middleware2: OutboxMiddleware = {
        beforeEmit: vi.fn((event) => {
          callOrder.push('middleware2');
          return { ...event, field2: 'value2' };
        }),
      };

      const transactionalEventEmitter = new TransactionalEventEmitter(
        outboxOptions,
        mockedDriverFactory,
        mockedEventConfigurationResolver,
        [middleware1, middleware2],
      );

      await transactionalEventEmitter.emit({ name: 'newEvent' });

      expect(callOrder).toEqual(['middleware1', 'middleware2']);
      expect(mockedDriver.createOutboxTransportEvent).toHaveBeenCalledWith(
        'newEvent',
        { name: 'newEvent', field1: 'value1', field2: 'value2' },
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('Should skip middlewares without beforeEmit', async () => {
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

      const middlewareWithBeforeEmit: OutboxMiddleware = {
        beforeEmit: vi.fn((event) => ({ ...event, field1: 'value1' })),
      };

      const middlewareWithoutBeforeEmit: OutboxMiddleware = {
        beforeProcess: vi.fn(),
      };

      const transactionalEventEmitter = new TransactionalEventEmitter(
        outboxOptions,
        mockedDriverFactory,
        mockedEventConfigurationResolver,
        [middlewareWithoutBeforeEmit, middlewareWithBeforeEmit],
      );

      await transactionalEventEmitter.emit({ name: 'newEvent' });

      expect(middlewareWithBeforeEmit.beforeEmit).toHaveBeenCalled();
      expect(mockedDriver.createOutboxTransportEvent).toHaveBeenCalledWith(
        'newEvent',
        { name: 'newEvent', field1: 'value1' },
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('Should work without middlewares (backwards compatibility)', async () => {
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

      const transactionalEventEmitter = new TransactionalEventEmitter(
        outboxOptions,
        mockedDriverFactory,
        mockedEventConfigurationResolver,
      );

      const newEvent = { name: 'newEvent' };
      await transactionalEventEmitter.emit(newEvent);

      expect(mockedDriver.createOutboxTransportEvent).toHaveBeenCalledWith(
        'newEvent',
        newEvent,
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('Should support async beforeEmit', async () => {
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

      const middleware: OutboxMiddleware = {
        beforeEmit: vi.fn(async (event) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { ...event, asyncField: 'asyncValue' };
        }),
      };

      const transactionalEventEmitter = new TransactionalEventEmitter(
        outboxOptions,
        mockedDriverFactory,
        mockedEventConfigurationResolver,
        [middleware],
      );

      await transactionalEventEmitter.emit({ name: 'newEvent' });

      expect(mockedDriver.createOutboxTransportEvent).toHaveBeenCalledWith(
        'newEvent',
        { name: 'newEvent', asyncField: 'asyncValue' },
        expect.any(Number),
        expect.any(Number),
      );
    });
  });
});
