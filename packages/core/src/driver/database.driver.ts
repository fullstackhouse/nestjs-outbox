import { InboxOutboxTransportEvent } from '../model/inbox-outbox-transport-event.interface';
import { DatabaseDriverPersister } from './database.driver-persister';

export interface DatabaseDriver extends DatabaseDriverPersister {
  createInboxOutboxTransportEvent(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): InboxOutboxTransportEvent;
  findAndExtendReadyToRetryEvents(limit: number): Promise<InboxOutboxTransportEvent[]>;
}
