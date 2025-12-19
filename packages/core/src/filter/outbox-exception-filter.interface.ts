import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { OutboxEventContext } from '../middleware/outbox-middleware.interface';
import { OutboxHost } from './outbox-arguments-host';

/**
 * Type alias for NestJS ExceptionFilter used in outbox context.
 *
 * Uses the standard NestJS ExceptionFilter interface with ArgumentsHost.
 * The host will be an OutboxHost with type 'outbox', allowing you to use
 * `host.switchToOutbox().getContext()` to access the OutboxEventContext.
 *
 * @example
 * ```typescript
 * import { Catch, ArgumentsHost } from '@nestjs/common';
 * import { OutboxExceptionFilter, isOutboxContext } from '@fullstackhouse/nestjs-outbox';
 * import * as Sentry from '@sentry/node';
 *
 * @Catch()
 * export class SentryExceptionFilter implements OutboxExceptionFilter {
 *   catch(exception: Error, host: ArgumentsHost): void {
 *     if (!isOutboxContext(host)) return;
 *
 *     const context = host.switchToOutbox().getContext();
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
 *
 * You can also create a filter that handles both HTTP and outbox contexts:
 *
 * @example
 * ```typescript
 * @Catch()
 * export class AllExceptionsFilter implements ExceptionFilter {
 *   catch(exception: Error, host: ArgumentsHost): void {
 *     if (isOutboxContext(host)) {
 *       const ctx = host.switchToOutbox().getContext();
 *       // Handle outbox error
 *     } else if (host.getType() === 'http') {
 *       const ctx = host.switchToHttp();
 *       // Handle HTTP error
 *     }
 *   }
 * }
 * ```
 */
export type OutboxExceptionFilter<T = any> = ExceptionFilter<T>;

export type OutboxExceptionFilterClass = new (...args: any[]) => OutboxExceptionFilter;

export const OUTBOX_EXCEPTION_FILTERS_TOKEN = 'OUTBOX_EXCEPTION_FILTERS_TOKEN';
