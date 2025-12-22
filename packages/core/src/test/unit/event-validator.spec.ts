import { EventValidator } from '../../event-validator/event.validator';
import { OutboxModuleOptions } from '../../outbox.module-definition';

describe('EventValidator', () => {
  it('should throw an exception when event names are not unique', () => {
    const mockOptions: OutboxModuleOptions = {
      driverFactory: null as any,
      maxEventsPerPoll: 10,
      pollingInterval: 1000,
      events: [
        {
          name: 'event1',
          listeners: {
            retentionPeriod: 1000,
            maxRetries: 5,
            maxExecutionTime: 1000,
          },
        },
        {
          name: 'event1',
          listeners: {
            retentionPeriod: 1000,
            maxRetries: 5,
            maxExecutionTime: 1000,
          },
        },
      ],
    };

    const eventValidator = new EventValidator(mockOptions);

    expect(() => eventValidator.onModuleInit()).toThrow(`Event names must be unique. Duplicate name: event1`);
  });

  it('should not throw an exception when event names are unique', () => {
    const mockOptions: OutboxModuleOptions = {
      driverFactory: null as any,
      maxEventsPerPoll: 10,
      pollingInterval: 1000,
      events: [
        {
          name: 'event1',
          listeners: {
            retentionPeriod: 1000,
            maxRetries: 5,
            maxExecutionTime: 1000,
          },
        },
        {
          name: 'event2',
          listeners: {
            retentionPeriod: 1000,
            maxRetries: 5,
            maxExecutionTime: 1000,
          },
        },
      ],
    };

    const eventValidator = new EventValidator(mockOptions);

    expect(() => eventValidator.onModuleInit()).not.toThrow();
  });
});
