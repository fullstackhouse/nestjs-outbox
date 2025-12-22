export type OutboxEventStatus = 'pending' | 'failed';

export interface OutboxTransportEvent {
  id: number;
  eventName: string;
  eventPayload: any;
  deliveredToListeners: string[];
  attemptAt: number | null;
  retryCount: number;
  status: OutboxEventStatus;
  expireAt: number;
  insertedAt: number;
}
