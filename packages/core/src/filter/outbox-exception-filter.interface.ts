import { OutboxEventContext } from '../middleware/outbox-middleware.interface';

/**
 * Exception filter interface for handling outbox processing errors.
 *
 * Unlike NestJS's built-in ExceptionFilter (which requires ArgumentsHost with
 * HTTP/RPC/WS/GraphQL context), this interface is designed for the outbox
 * processing context which runs outside of any request lifecycle.
 *
 * @example
 * ```typescript
 * import { Injectable } from '@nestjs/common';
 * import { OutboxExceptionFilter, OutboxEventContext } from '@fullstackhouse/nestjs-outbox';
 * import * as Sentry from '@sentry/node';
 *
 * @Injectable()
 * export class SentryOutboxExceptionFilter implements OutboxExceptionFilter {
 *   catch(exception: Error, context: OutboxEventContext): void {
 *     Sentry.captureException(exception, {
 *       tags: {
 *         eventName: context.eventName,
 *         listenerName: context.listenerName,
 *       },
 *       extra: {
 *         eventId: context.eventId,
 *         eventPayload: context.eventPayload,
 *       },
 *     });
 *   }
 * }
 * ```
 */
export interface OutboxExceptionFilter {
  catch(exception: Error, context: OutboxEventContext): void | Promise<void>;
}

export type OutboxExceptionFilterClass = new (...args: any[]) => OutboxExceptionFilter;

export const OUTBOX_EXCEPTION_FILTERS_TOKEN = 'OUTBOX_EXCEPTION_FILTERS_TOKEN';
