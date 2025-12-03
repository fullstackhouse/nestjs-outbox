import { InboxOutboxTransportEvent } from '@nestixis/nestjs-inbox-outbox';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({
  name: 'inbox_outbox_transport_event',
})
export class TypeOrmInboxOutboxTransportEvent implements InboxOutboxTransportEvent {
  @PrimaryGeneratedColumn()
  id: number; 

  @Column({
    name: 'event_name',
  })
  eventName: string;

  @Column({
    type: 'json',
    name: 'event_payload',
  })
  eventPayload: any;

  @Column({
    type: 'json',
    name: 'delivered_to_listeners',
  })
  deliveredToListeners: string[];

  @Column({
    name: 'ready_to_retry_after',
    type: 'bigint',
    nullable: true,
  })
  readyToRetryAfter: number;

  @Column({
    name: 'expire_at',
    type: 'bigint',
  })
  expireAt: number;

  @Column({
    name: 'inserted_at',
    type: 'bigint',
  })
  insertedAt: number;

  create(eventName: string, eventPayload: any, expireAt: number, readyToRetryAfter: number | null): InboxOutboxTransportEvent {
    const event = new TypeOrmInboxOutboxTransportEvent();
    event.eventName = eventName;
    event.eventPayload = eventPayload;
    event.expireAt = expireAt;
    event.readyToRetryAfter = readyToRetryAfter;
    event.insertedAt = Date.now();
    event.deliveredToListeners = [];
    return event;
  }
}
