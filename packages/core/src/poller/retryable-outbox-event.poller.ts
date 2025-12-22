import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EMPTY, Subscription, asyncScheduler, catchError, concatMap, from, interval, merge, repeat, throttleTime } from 'rxjs';
import { DATABASE_DRIVER_FACTORY_TOKEN, DatabaseDriverFactory } from '../driver/database-driver.factory';
import { TransactionalEventEmitter } from '../emitter/transactional-event-emitter';
import { OutboxModuleOptions, MODULE_OPTIONS_TOKEN } from '../outbox.module-definition';
import { OutboxTransportEvent } from '../model/outbox-transport-event.interface';
import { OUTBOX_EVENT_PROCESSOR_TOKEN, OutboxEventProcessorContract } from '../processor/outbox-event-processor.contract';
import { EventConfigurationResolver } from '../resolver/event-configuration.resolver';
import { EVENT_LISTENER_TOKEN, EventListener } from './event-listener.interface';
import { createDeadLetterContext, OutboxMiddleware, OUTBOX_MIDDLEWARES_TOKEN } from '../middleware/outbox-middleware.interface';

@Injectable()
export class RetryableOutboxEventPoller implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription | null = null;
  private inFlightProcessing: Set<Promise<unknown>> = new Set();
  private isShuttingDown = false;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) private options: OutboxModuleOptions,
    @Inject(DATABASE_DRIVER_FACTORY_TOKEN) private databaseDriverFactory: DatabaseDriverFactory,
    @Inject(OUTBOX_EVENT_PROCESSOR_TOKEN) private outboxEventProcessor: OutboxEventProcessorContract,
    private transactionalEventEmitter: TransactionalEventEmitter,
    private eventConfigurationResolver: EventConfigurationResolver,
    @Inject(Logger) private logger: Logger,
    @Optional() @Inject(EVENT_LISTENER_TOKEN) private eventListener?: EventListener,
    @Optional() @Inject(OUTBOX_MIDDLEWARES_TOKEN) private middlewares?: OutboxMiddleware[],
  ) {}

  async onModuleInit() {
    this.logger.log(`Poller options: pollingInterval: ${this.options.pollingInterval}, maxEventsPerPoll: ${this.options.maxEventsPerPoll}, events: ${JSON.stringify(this.options.events)}, driver: ${this.options.driverFactory.constructor.name}`);

    if (this.eventListener) {
      try {
        await this.eventListener.connect();
        this.logger.log('Event listener connected for instant event processing');
      } catch (error) {
        this.logger.warn(`Failed to connect event listener, falling back to polling only: ${error}`);
      }
    }

    const pollingSource$ = interval(this.options.pollingInterval);
    const throttleMs = this.options.eventListenerThrottleMs ?? 100;
    const throttledEventSource$ = (this.eventListener?.events$ ?? EMPTY).pipe(
      throttleTime(throttleMs, asyncScheduler, { leading: true, trailing: true }),
    );

    this.subscription = merge(pollingSource$, throttledEventSource$)
      .pipe(
        concatMap(() => {
          if (this.isShuttingDown) {
            return EMPTY;
          }
          return from(this.poolRetryableEvents());
        }),
        catchError((exception) => {
          this.logger.error(exception);
          return EMPTY;
        }),
        repeat(),
      )
      .subscribe();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down RetryableOutboxEventPoller...');

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    if (this.eventListener) {
      try {
        await this.eventListener.disconnect();
      } catch (error) {
        this.logger.warn(`Error disconnecting event listener: ${error}`);
      }
    }

    if (this.inFlightProcessing.size > 0) {
      this.logger.log(`Waiting for ${this.inFlightProcessing.size} in-flight event(s) to complete...`);
      await Promise.allSettled([...this.inFlightProcessing]);
      this.logger.log('All in-flight events completed.');
    }

    this.logger.log('RetryableOutboxEventPoller shutdown complete.');
  }

  async poolRetryableEvents() {
    try {
      const maxEventsPerPoll = this.options.maxEventsPerPoll;
      const databaseDriver = this.databaseDriverFactory.create(this.eventConfigurationResolver);

      const { pendingEvents, deadLetteredEvents } = await databaseDriver.findAndExtendReadyToRetryEvents(maxEventsPerPoll);

      if (deadLetteredEvents.length > 0) {
        await this.invokeDeadLetterHandlers(deadLetteredEvents);
      }

      if (pendingEvents.length > 0) {
        await this.processAsynchronousRetryableEvents(pendingEvents);
      }
    } catch (exception) {
      this.logger.error(exception);
    }
  }

  private async invokeDeadLetterHandlers(deadLetteredEvents: OutboxTransportEvent[]) {
    if (!this.middlewares) {
      return;
    }

    for (const event of deadLetteredEvents) {
      const context = createDeadLetterContext(event);

      for (const middleware of this.middlewares) {
        if (middleware.onDeadLetter) {
          try {
            await middleware.onDeadLetter(context);
          } catch (error) {
            this.logger.error(`Error invoking onDeadLetter middleware for event ${event.eventName} (id: ${event.id}): ${error}`);
          }
        }
      }
    }
  }

  private async processAsynchronousRetryableEvents(outboxTransportEvents: OutboxTransportEvent[]) {
    const processingPromises = outboxTransportEvents.map((outboxTransportEvent) => {
      const notDeliveredToListeners = this.transactionalEventEmitter.getListeners(outboxTransportEvent.eventName).filter((listener) => {
        return !outboxTransportEvent.deliveredToListeners.includes(listener.getName());
      });

      const processingPromise = this.outboxEventProcessor.process(
        this.options.events.find((event) => event.name === outboxTransportEvent.eventName),
        outboxTransportEvent,
        notDeliveredToListeners,
      );

      this.inFlightProcessing.add(processingPromise);
      processingPromise.finally(() => {
        this.inFlightProcessing.delete(processingPromise);
      });

      return processingPromise;
    });

    return Promise.allSettled(processingPromises);
  }
}
