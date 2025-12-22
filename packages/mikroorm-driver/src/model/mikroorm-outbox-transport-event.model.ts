import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { OutboxTransportEvent, OutboxEventStatus } from '@fullstackhouse/nestjs-outbox';

@Entity({
  tableName: 'outbox_transport_event',
})
export class MikroOrmOutboxTransportEvent implements OutboxTransportEvent {
  @PrimaryKey()
  id: number;

  @Property()
  eventName: string;

  @Property({
    type: 'json',
  })
  eventPayload: any;

  @Property({
    type: 'json',
    fieldName: 'delivered_to_listeners',
  })
  deliveredToListeners: string[];

  @Property({ type: 'bigint', nullable: true })
  readyToRetryAfter: number | null;

  @Property({ type: 'int', default: 0 })
  retryCount: number;

  @Property({ type: 'varchar', length: 20, default: 'pending' })
  status: OutboxEventStatus;

  @Property({ type: 'bigint' })
  expireAt: number;

  @Property({ type: 'bigint' })
  insertedAt: number;

  create(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): OutboxTransportEvent {
    const event = new MikroOrmOutboxTransportEvent();
    event.eventName = eventName;
    event.eventPayload = eventPayload;
    event.expireAt = expireAt;
    event.readyToRetryAfter = readyToRetryAfter;
    event.retryCount = 0;
    event.status = 'pending';
    event.insertedAt = Date.now();
    event.deliveredToListeners = [];
    return event;
  }
}
