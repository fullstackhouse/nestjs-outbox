import { EntityManager, LockMode } from '@mikro-orm/core';
import { DatabaseDriver, EventConfigurationResolverContract, InboxOutboxTransportEvent } from '@nestixis/nestjs-inbox-outbox';
import { MikroOrmInboxOutboxTransportEvent } from '../model/mikroorm-inbox-outbox-transport-event.model';

export interface MikroORMDatabaseDriverOptions {
  clearAfterFlush?: boolean;
}

export class MikroORMDatabaseDriver implements DatabaseDriver {
  private readonly clearAfterFlush: boolean;

  constructor(
    private readonly em: EntityManager,
    private readonly eventConfigurationResolver: EventConfigurationResolverContract,
    options?: MikroORMDatabaseDriverOptions,
  ) {
    this.clearAfterFlush = options?.clearAfterFlush ?? true;
  }

  async findAndExtendReadyToRetryEvents(limit: number): Promise<InboxOutboxTransportEvent[]> {

    let events = [];

    await this.em.transactional(async em => {
      const now = new Date();
      events = await em.find(MikroOrmInboxOutboxTransportEvent, { readyToRetryAfter: { $lte: now.getTime() } }, {
        limit,
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });

      events.forEach(event => {
        const eventConfig = this.eventConfigurationResolver.resolve(event.eventName);
        event.readyToRetryAfter = new Date(now.getTime() + eventConfig.listeners.readyToRetryAfterTTL ).getTime();
      });

      await em.flush();
    });
    
    return events;

  }

  async persist<T extends Object>(entity: T): Promise<void> {
    this.em.persist(entity);
  }

  async remove<T extends Object>(entity: T): Promise<void> {
    this.em.remove(entity);
  }

  async flush(): Promise<void> {
    await this.em.flush();
    if (this.clearAfterFlush) {
      this.em.clear();
    }
  }

  createInboxOutboxTransportEvent(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): InboxOutboxTransportEvent {
    return new MikroOrmInboxOutboxTransportEvent().create(eventName, eventPayload, expireAt, readyToRetryAfter);
  }
}
