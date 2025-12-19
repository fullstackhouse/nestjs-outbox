import { ExceptionFilter } from '@nestjs/common';

/**
 * Type alias for NestJS ExceptionFilter used in outbox context.
 *
 * Uses the standard NestJS ExceptionFilter interface with ArgumentsHost.
 * The host will be an OutboxHost with type 'outbox', allowing you to use
 * `host.switchToOutbox().getContext()` to access the OutboxEventContext.
 *
 * Register your exception filter globally using NestJS's APP_FILTER token:
 *
 * @example
 * ```typescript
 * // app.module.ts
 * import { Module } from '@nestjs/common';
 * import { APP_FILTER } from '@nestjs/core';
 * import { SentryExceptionFilter } from './sentry-exception.filter';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_FILTER,
 *       useClass: SentryExceptionFilter,
 *     },
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * ```typescript
 * // sentry-exception.filter.ts
 * import { Catch, ArgumentsHost, ExceptionFilter } from '@nestjs/common';
 * import { isOutboxContext } from '@fullstackhouse/nestjs-outbox';
 * import * as Sentry from '@sentry/node';
 *
 * @Catch()
 * export class SentryExceptionFilter implements ExceptionFilter {
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
