import { OutboxTransportEvent, OutboxEventStatus } from '@fullstackhouse/nestjs-outbox';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({
  name: 'outbox_transport_event',
})
export class TypeOrmOutboxTransportEvent implements OutboxTransportEvent {
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
    name: 'attempt_at',
    type: 'bigint',
    nullable: true,
  })
  attemptAt: number | null;

  @Column({
    name: 'retry_count',
    type: 'int',
    default: 0,
  })
  retryCount: number;

  @Index()
  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  status: OutboxEventStatus;

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

  create(eventName: string, eventPayload: any, expireAt: number, attemptAt: number | null): OutboxTransportEvent {
    const event = new TypeOrmOutboxTransportEvent();
    event.eventName = eventName;
    event.eventPayload = eventPayload;
    event.expireAt = expireAt;
    event.attemptAt = attemptAt;
    event.retryCount = 0;
    event.status = 'pending';
    event.insertedAt = Date.now();
    event.deliveredToListeners = [];
    return event;
  }
}
