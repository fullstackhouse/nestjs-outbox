import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_DRIVER_FACTORY_TOKEN, DatabaseDriverFactory } from '../driver/database-driver.factory';
import { OUTBOX_EVENT_PROCESSOR_TOKEN, OutboxEventProcessorContract } from '../processor/outbox-event-processor.contract';
import { EVENT_CONFIGURATION_RESOLVER_TOKEN, EventConfigurationResolverContract } from '../resolver/event-configuration-resolver.contract';
import { TransactionalEventEmitter } from '../emitter/transactional-event-emitter';

export interface FlushResult {
  processedCount: number;
  failedCount: number;
}

@Injectable()
export class OutboxEventFlusher {
  constructor(
    @Inject(DATABASE_DRIVER_FACTORY_TOKEN) private databaseDriverFactory: DatabaseDriverFactory,
    @Inject(OUTBOX_EVENT_PROCESSOR_TOKEN) private outboxEventProcessor: OutboxEventProcessorContract,
    @Inject(EVENT_CONFIGURATION_RESOLVER_TOKEN) private eventConfigurationResolver: EventConfigurationResolverContract,
    private transactionalEventEmitter: TransactionalEventEmitter,
  ) {}

  async processAllPendingEvents(limit: number = 1000): Promise<FlushResult> {
    const databaseDriver = this.databaseDriverFactory.create(this.eventConfigurationResolver);
    const pendingEvents = await databaseDriver.findPendingEvents(limit);

    let processedCount = 0;
    let failedCount = 0;

    for (const event of pendingEvents) {
      const eventConfig = this.eventConfigurationResolver.resolve(event.eventName);
      const allListeners = this.transactionalEventEmitter.getListeners(event.eventName);
      const pendingListeners = allListeners.filter(
        (listener) => !event.deliveredToListeners.includes(listener.getName())
      );

      if (pendingListeners.length === 0) {
        continue;
      }

      try {
        await this.outboxEventProcessor.process(eventConfig, event, pendingListeners);
        processedCount++;
      } catch {
        failedCount++;
      }
    }

    return { processedCount, failedCount };
  }
}
