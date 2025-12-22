import { OutboxEvent } from '../emitter/contract/outbox-event.interface';
import { OutboxTransportEvent } from '../model/outbox-transport-event.interface';

export interface OutboxEventContext {
  eventName: string;
  eventPayload: unknown;
  eventId: number;
  listenerName: string;
}

export interface DeadLetterContext {
  eventName: string;
  eventPayload: unknown;
  eventId: number;
  retryCount: number;
  deliveredToListeners: string[];
}

export interface OutboxListenerResult {
  success: boolean;
  error?: Error;
  durationMs: number;
}

export interface OutboxMiddleware {
  beforeEmit?(event: OutboxEvent): OutboxEvent | Promise<OutboxEvent>;
  beforeProcess?(context: OutboxEventContext): void | Promise<void>;
  afterProcess?(context: OutboxEventContext, result: OutboxListenerResult): void | Promise<void>;
  onError?(context: OutboxEventContext, error: Error): void | Promise<void>;
  onDeadLetter?(context: DeadLetterContext): void | Promise<void>;
  wrapExecution?<T>(context: OutboxEventContext, next: () => Promise<T>): Promise<T>;
}

export type DeadLetterHandler = (context: DeadLetterContext) => void | Promise<void>;

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

export function createDeadLetterContext(
  outboxTransportEvent: OutboxTransportEvent,
): DeadLetterContext {
  return {
    eventName: outboxTransportEvent.eventName,
    eventPayload: outboxTransportEvent.eventPayload,
    eventId: outboxTransportEvent.id,
    retryCount: outboxTransportEvent.retryCount,
    deliveredToListeners: outboxTransportEvent.deliveredToListeners,
  };
}
