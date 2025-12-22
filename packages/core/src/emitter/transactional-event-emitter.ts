import { Inject, Injectable, Optional } from '@nestjs/common';
import { DATABASE_DRIVER_FACTORY_TOKEN, DatabaseDriverFactory } from '../driver/database-driver.factory';
import { DatabaseDriverPersister } from '../driver/database.driver-persister';
import { OutboxModuleEventOptions, OutboxModuleOptions, MODULE_OPTIONS_TOKEN } from '../outbox.module-definition';
import { IListener } from '../listener/contract/listener.interface';
import { ListenerDuplicateNameException } from '../listener/exception/listener-duplicate-name.exception';
import { OUTBOX_MIDDLEWARES_TOKEN, OutboxMiddleware } from '../middleware/outbox-middleware.interface';
import { OUTBOX_EVENT_PROCESSOR_TOKEN, OutboxEventProcessorContract } from '../processor/outbox-event-processor.contract';
import { EVENT_CONFIGURATION_RESOLVER_TOKEN, EventConfigurationResolverContract } from '../resolver/event-configuration-resolver.contract';
import { OutboxEvent } from './contract/outbox-event.interface';

export enum TransactionalEventEmitterOperations {
  persist = 'persist',
  remove = 'remove',
}

@Injectable()
export class TransactionalEventEmitter {
  private listeners: Map<string, IListener<any>[]> = new Map();

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) private options: OutboxModuleOptions,
    @Inject(DATABASE_DRIVER_FACTORY_TOKEN) private databaseDriverFactory: DatabaseDriverFactory,
    @Inject(OUTBOX_EVENT_PROCESSOR_TOKEN) private outboxEventProcessor: OutboxEventProcessorContract,
    @Inject(EVENT_CONFIGURATION_RESOLVER_TOKEN) private eventConfigurationResolver: EventConfigurationResolverContract,
    @Optional() @Inject(OUTBOX_MIDDLEWARES_TOKEN) private middlewares: OutboxMiddleware[] = [],
  ) {}

  private async applyBeforeEmitMiddlewares(event: OutboxEvent): Promise<OutboxEvent> {
    let processedEvent = event;
    for (const middleware of this.middlewares) {
      if (middleware.beforeEmit) {
        processedEvent = await middleware.beforeEmit(processedEvent);
      }
    }
    return processedEvent;
  }

  private async emitInternal(
    event: OutboxEvent,
    entities: {
      operation: TransactionalEventEmitterOperations;
      entity: object;
    }[],
    customDatabaseDriverPersister?: DatabaseDriverPersister,
    awaitProcessor: boolean = false,
  ): Promise<void> {
    const processedEvent = await this.applyBeforeEmitMiddlewares(event);

    const eventOptions: OutboxModuleEventOptions = this.options.events.find((optionEvent) => optionEvent.name === processedEvent.name);
    if (!eventOptions) {
      throw new Error(`Event ${processedEvent.name} is not configured. Did you forget to add it to the module options?`);
    }

    const databaseDriver = this.databaseDriverFactory.create(this.eventConfigurationResolver);
    const currentTimestamp = new Date().getTime();
    
    const outboxTransportEvent = databaseDriver.createOutboxTransportEvent(
      processedEvent.name,
      processedEvent,
      currentTimestamp + eventOptions.listeners.expiresAtTTL,
      currentTimestamp + eventOptions.listeners.readyToRetryAfterTTL,
    );
    const persister = customDatabaseDriverPersister ?? databaseDriver;
    
    entities.forEach((entity) => {
      if (entity.operation === TransactionalEventEmitterOperations.persist) {
        persister.persist(entity.entity);
      }
      if (entity.operation === TransactionalEventEmitterOperations.remove) {
        persister.remove(entity.entity);
      }
    });

    persister.persist(outboxTransportEvent);
    await persister.flush();

    if (eventOptions.immediateProcessing === false) {
      return;
    }

    if (awaitProcessor) {
      await this.outboxEventProcessor.process(eventOptions, outboxTransportEvent, this.getListeners(processedEvent.name));
      return;
    }

    this.outboxEventProcessor.process(eventOptions, outboxTransportEvent, this.getListeners(processedEvent.name));
  }

  async emit(
    event: OutboxEvent,
    entities: {
      operation: TransactionalEventEmitterOperations;
      entity: object;
    }[] = [],
    customDatabaseDriverPersister?: DatabaseDriverPersister,
  ): Promise<void> {
    return this.emitInternal(event, entities, customDatabaseDriverPersister, false);
  }

  async emitAsync(
    event: OutboxEvent,
    entities: {
      operation: TransactionalEventEmitterOperations;
      entity: object;
    }[] = [],
    customDatabaseDriverPersister?: DatabaseDriverPersister,
  ): Promise<void> {
    return this.emitInternal(event, entities, customDatabaseDriverPersister, true);
  }

  addListener<TPayload>(eventName: string, listener: IListener<TPayload>): void {
    const previousListeners = this.listeners.get(eventName) || [];
    if (previousListeners.some((previousListener) => previousListener.getName() === listener.getName())) {
      throw new ListenerDuplicateNameException(listener.getName());
    }
    this.listeners.set(eventName, [...previousListeners, listener]);
  }

  removeListeners(eventName: string): void {
    this.listeners.delete(eventName);
  }

  getListeners<TPayload>(eventName: string): IListener<TPayload>[] {
    return this.listeners.get(eventName) || [];
  }

  getEventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}
