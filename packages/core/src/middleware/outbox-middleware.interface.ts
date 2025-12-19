import { OutboxTransportEvent } from '../model/outbox-transport-event.interface';

export interface OutboxEventContext {
  eventName: string;
  eventPayload: unknown;
  eventId: number;
  listenerName: string;
}

export interface OutboxListenerResult {
  success: boolean;
  error?: Error;
  durationMs: number;
}

export interface OutboxMiddleware {
  beforeProcess?(context: OutboxEventContext): void | Promise<void>;
  afterProcess?(context: OutboxEventContext, result: OutboxListenerResult): void | Promise<void>;
  onError?(context: OutboxEventContext, error: Error): void | Promise<void>;
  wrapExecution?<T>(context: OutboxEventContext, next: () => Promise<T>): Promise<T>;
}

export type OutboxMiddlewareClass = new (...args: any[]) => OutboxMiddleware;

export const OUTBOX_MIDDLEWARES_TOKEN = 'OUTBOX_MIDDLEWARES_TOKEN';

export function createOutboxEventContext(
  outboxTransportEvent: OutboxTransportEvent,
  listenerName: string,
): OutboxEventContext {
  return {
    eventName: outboxTransportEvent.eventName,
    eventPayload: outboxTransportEvent.eventPayload,
    eventId: outboxTransportEvent.id,
    listenerName,
  };
}
