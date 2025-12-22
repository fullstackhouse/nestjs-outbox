export type OutboxEventStatus = 'pending' | 'dlq';

export interface OutboxTransportEvent {
  id: number;
  eventName: string;
  eventPayload: any;
  deliveredToListeners: string[];
  readyToRetryAfter: number | null;
  retryCount: number;
  status: OutboxEventStatus;
  expireAt: number;
  insertedAt: number;
}
