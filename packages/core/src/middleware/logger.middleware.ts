import { Injectable, Logger } from '@nestjs/common';
import { OutboxEventContext, OutboxListenerResult, OutboxMiddleware } from './outbox-middleware.interface';

const MAX_PAYLOAD_LENGTH = 200;

@Injectable()
export class LoggerMiddleware implements OutboxMiddleware {
  private readonly logger = new Logger('Outbox');

  beforeProcess(context: OutboxEventContext): void {
    const logContext = getLoggerContext(context);
    this.logger.log(`OUTBOX START ${context.eventName}`, logContext);
  }

  afterProcess(context: OutboxEventContext, result: OutboxListenerResult): void {
    const logContext = getLoggerContext(context);
    if (result.success) {
      this.logger.log(`OUTBOX END   ${context.eventName}`, {
        ...logContext,
        processTime: result.durationMs,
      });
    } else {
      this.logger.error(`OUTBOX FAIL  ${context.eventName}`, {
        ...logContext,
        processTime: result.durationMs,
        error: result.error?.message ?? 'Unknown error',
      });
    }
  }
}

function getLoggerContext(context: OutboxEventContext) {
  const payloadString = JSON.stringify(context.eventPayload);
  const truncatedPayload =
    payloadString.length > MAX_PAYLOAD_LENGTH
      ? payloadString.substring(0, MAX_PAYLOAD_LENGTH) + '...'
      : payloadString;

  return {
    eventId: context.eventId,
    listener: context.listenerName,
    payload: truncatedPayload,
  };
}
