import { OutboxTransportEvent } from '../model/outbox-transport-event.interface';
import { DatabaseDriverPersister } from './database.driver-persister';

export interface DatabaseDriver extends DatabaseDriverPersister {
  createOutboxTransportEvent(eventName: string, eventPayload: any, expireAt: number, attemptAt: number | null): OutboxTransportEvent;
  findAndExtendReadyToRetryEvents(limit: number): Promise<OutboxTransportEvent[]>;
  findPendingEvents(limit: number): Promise<OutboxTransportEvent[]>;
}
