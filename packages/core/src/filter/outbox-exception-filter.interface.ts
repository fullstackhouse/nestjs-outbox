import { OutboxEventContext } from '../middleware/outbox-middleware.interface';

export interface OutboxExceptionFilter {
  catch(exception: Error, context: OutboxEventContext): void | Promise<void>;
}

export type OutboxExceptionFilterClass = new (...args: any[]) => OutboxExceptionFilter;

export const OUTBOX_EXCEPTION_FILTERS_TOKEN = 'OUTBOX_EXCEPTION_FILTERS_TOKEN';
