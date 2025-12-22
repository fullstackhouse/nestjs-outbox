import { DatabaseDriver, EventConfigurationResolverContract, OutboxTransportEvent, defaultRetryStrategy } from '@fullstackhouse/nestjs-outbox';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { TypeOrmOutboxTransportEvent } from '../model/typeorm-outbox-transport-event.model';

const DEFAULT_MAX_RETRIES = 5;

export class TypeORMDatabaseDriver implements DatabaseDriver {
  private entitiesToPersist: object[] = [];
  private entitiesToRemove: object[] = [];

  constructor(private readonly dataSource: DataSource, private readonly eventConfigurationResolver: EventConfigurationResolverContract) {}

  async findAndExtendReadyToRetryEvents(limit: number): Promise<OutboxTransportEvent[]> {
    let events: TypeOrmOutboxTransportEvent[] = [];

    await this.dataSource.transaction(async (transactionalEntityManager) => {
      const now = new Date();

      events = await transactionalEntityManager.find(TypeOrmOutboxTransportEvent, {
        where: {
          readyToRetryAfter: LessThanOrEqual(now.getTime()),
          status: 'pending',
        },
        take: limit,
        lock: { mode: 'pessimistic_write' },
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

      await transactionalEntityManager.save(events);
    });

    return events.filter(e => e.status === 'pending');
  }

  async persist<T extends object>(entity: T): Promise<void> {
    this.entitiesToPersist.push(entity);
  }

  async remove<T extends object>(entity: T): Promise<void> {
    this.entitiesToRemove.push(entity);
  }

  async flush(): Promise<void> {
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.save(this.entitiesToPersist);
      await transactionalEntityManager.remove(this.entitiesToRemove);
    });

    this.entitiesToPersist = [];
    this.entitiesToRemove = [];
  }

  createOutboxTransportEvent(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): OutboxTransportEvent {
    return new TypeOrmOutboxTransportEvent().create(eventName, eventPayload, expireAt, readyToRetryAfter);
  }

  async findPendingEvents(limit: number): Promise<OutboxTransportEvent[]> {
    return this.dataSource.getRepository(TypeOrmOutboxTransportEvent).find({
      where: { status: 'pending' },
      take: limit,
    });
  }
}
