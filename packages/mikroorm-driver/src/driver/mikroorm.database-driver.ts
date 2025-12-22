import { EntityManager, LockMode } from '@mikro-orm/core';
import { DatabaseDriver, EventConfigurationResolverContract, OutboxTransportEvent, defaultRetryStrategy } from '@fullstackhouse/nestjs-outbox';
import { MikroOrmOutboxTransportEvent } from '../model/mikroorm-outbox-transport-event.model';

export interface MikroORMDatabaseDriverOptions {
  clearAfterFlush?: boolean;
}

const DEFAULT_MAX_RETRIES = 5;

export class MikroORMDatabaseDriver implements DatabaseDriver {
  private readonly clearAfterFlush: boolean;

  constructor(
    private readonly em: EntityManager,
    private readonly eventConfigurationResolver: EventConfigurationResolverContract,
    options?: MikroORMDatabaseDriverOptions,
  ) {
    this.clearAfterFlush = options?.clearAfterFlush ?? true;
  }

  async findAndExtendReadyToRetryEvents(limit: number): Promise<OutboxTransportEvent[]> {
    let events: MikroOrmOutboxTransportEvent[] = [];

    await this.em.transactional(async em => {
      const now = new Date();
      events = await em.find(MikroOrmOutboxTransportEvent, {
        readyToRetryAfter: { $lte: now.getTime() },
        status: 'pending',
      }, {
        limit,
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });

      events.forEach(event => {
        const eventConfig = this.eventConfigurationResolver.resolve(event.eventName);
        const maxRetries = eventConfig.listeners.maxRetries ?? DEFAULT_MAX_RETRIES;

        event.retryCount += 1;

        if (event.retryCount >= maxRetries) {
          event.status = 'dlq';
          event.readyToRetryAfter = null;
        } else {
          const retryStrategy = eventConfig.listeners.retryStrategy ?? defaultRetryStrategy;
          const delayMs = retryStrategy(event.retryCount);
          event.readyToRetryAfter = now.getTime() + delayMs;
        }
      });

      await em.flush();
    });

    return events.filter(e => e.status === 'pending');
  }

  async persist<T extends object>(entity: T): Promise<void> {
    this.em.persist(entity);
  }

  async remove<T extends object>(entity: T): Promise<void> {
    this.em.remove(entity);
  }

  async flush(): Promise<void> {
    await this.em.flush();
    if (this.clearAfterFlush) {
      this.em.clear();
    }
  }

  createOutboxTransportEvent(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): OutboxTransportEvent {
    return new MikroOrmOutboxTransportEvent().create(eventName, eventPayload, expireAt, readyToRetryAfter);
  }

  async findPendingEvents(limit: number): Promise<OutboxTransportEvent[]> {
    return this.em.find(MikroOrmOutboxTransportEvent, { status: 'pending' }, { limit });
  }
}
