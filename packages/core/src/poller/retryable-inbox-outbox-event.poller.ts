import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EMPTY, Subscription, catchError, concatMap, from, interval, merge, repeat } from 'rxjs';
import { DATABASE_DRIVER_FACTORY_TOKEN, DatabaseDriverFactory } from '../driver/database-driver.factory';
import { TransactionalEventEmitter } from '../emitter/transactional-event-emitter';
import { InboxOutboxModuleOptions, MODULE_OPTIONS_TOKEN } from '../inbox-outbox.module-definition';
import { InboxOutboxTransportEvent } from '../model/inbox-outbox-transport-event.interface';
import { INBOX_OUTBOX_EVENT_PROCESSOR_TOKEN, InboxOutboxEventProcessorContract } from '../processor/inbox-outbox-event-processor.contract';
import { EventConfigurationResolver } from '../resolver/event-configuration.resolver';
import { EVENT_LISTENER_TOKEN, EventListener } from './event-listener.interface';

@Injectable()
export class RetryableInboxOutboxEventPoller implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription | null = null;
  private inFlightProcessing: Set<Promise<unknown>> = new Set();
  private isShuttingDown = false;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) private options: InboxOutboxModuleOptions,
    @Inject(DATABASE_DRIVER_FACTORY_TOKEN) private databaseDriverFactory: DatabaseDriverFactory,
    @Inject(INBOX_OUTBOX_EVENT_PROCESSOR_TOKEN) private inboxOutboxEventProcessor: InboxOutboxEventProcessorContract,
    private transactionalEventEmitter: TransactionalEventEmitter,
    private eventConfigurationResolver: EventConfigurationResolver,
    @Inject(Logger) private logger: Logger,
    @Optional() @Inject(EVENT_LISTENER_TOKEN) private eventListener?: EventListener,
  ) {}

  async onModuleInit() {
    this.logger.log(`Inbox options: retryEveryMilliseconds: ${this.options.retryEveryMilliseconds}, maxInboxOutboxTransportEventPerRetry: ${this.options.maxInboxOutboxTransportEventPerRetry}, events: ${JSON.stringify(this.options.events)}, driver: ${this.options.driverFactory.constructor.name}`);

    if (this.eventListener) {
      try {
        await this.eventListener.connect();
        this.logger.log('Database event listener connected for instant event processing');
      } catch (error) {
        this.logger.warn(`Failed to connect event listener, falling back to polling only: ${error}`);
      }
    }

    const pollingSource$ = interval(this.options.retryEveryMilliseconds);
    const eventSource$ = this.eventListener?.events$ ?? EMPTY;

    this.subscription = merge(pollingSource$, eventSource$)
      .pipe(
        concatMap(() => {
          if (this.isShuttingDown) {
            return EMPTY;
          }
          return from(this.poolRetryableEvents());
        }),
        catchError((exception) => {
          this.logger.error(exception);
          console.error(exception);
          return EMPTY;
        }),
        repeat(),
      )
      .subscribe();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down RetryableInboxOutboxEventPoller...');

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

    this.logger.log('RetryableInboxOutboxEventPoller shutdown complete.');
  }

  async poolRetryableEvents() {
    try {
      const maxInboxOutboxTransportEventPerRetry = this.options.maxInboxOutboxTransportEventPerRetry;
      const databaseDriver = this.databaseDriverFactory.create(this.eventConfigurationResolver);

      const readyToRetryEvents = await databaseDriver.findAndExtendReadyToRetryEvents(maxInboxOutboxTransportEventPerRetry);

      if (readyToRetryEvents.length === 0) {
        return;
      }

      if (readyToRetryEvents.length > 0) {
        await this.processAsynchronousRetryableEvents(readyToRetryEvents);
      }
    } catch (exception) {
      this.logger.error(exception);
      console.error(exception);
    }
  }

  private async processAsynchronousRetryableEvents(inboxOutboxTransportEvents: InboxOutboxTransportEvent[]) {
    const processingPromises = inboxOutboxTransportEvents.map((inboxOutboxTransportEvent) => {
      const notDeliveredToListeners = this.transactionalEventEmitter.getListeners(inboxOutboxTransportEvent.eventName).filter((listener) => {
        return !inboxOutboxTransportEvent.deliveredToListeners.includes(listener.getName());
      });

      const processingPromise = this.inboxOutboxEventProcessor.process(
        this.options.events.find((event) => event.name === inboxOutboxTransportEvent.eventName),
        inboxOutboxTransportEvent,
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
