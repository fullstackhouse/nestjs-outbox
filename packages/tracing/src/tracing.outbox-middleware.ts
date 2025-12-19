import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  Tracer,
} from '@opentelemetry/api';
import {
  OutboxMiddleware,
  OutboxEventContext,
  OutboxListenerResult,
  OutboxEvent,
} from '@fullstackhouse/nestjs-outbox';
import {
  TracingOutboxOptions,
  DEFAULT_TRACER_NAME,
  DEFAULT_TRACE_CONTEXT_FIELD,
} from './tracing-options.interface';

export const TRACING_OUTBOX_OPTIONS = 'TRACING_OUTBOX_OPTIONS';

type TraceContextCarrier = Record<string, string>;

@Injectable()
export class TracingOutboxMiddleware implements OutboxMiddleware {
  private readonly tracer: Tracer;
  private readonly traceContextFieldName: string;

  constructor(
    @Optional()
    @Inject(TRACING_OUTBOX_OPTIONS)
    options?: TracingOutboxOptions,
  ) {
    const tracerName = options?.tracerName ?? DEFAULT_TRACER_NAME;
    this.traceContextFieldName =
      options?.traceContextFieldName ?? DEFAULT_TRACE_CONTEXT_FIELD;
    this.tracer = trace.getTracer(tracerName);
  }

  beforeEmit(event: OutboxEvent): OutboxEvent {
    const carrier: TraceContextCarrier = {};
    propagation.inject(context.active(), carrier);

    return {
      ...event,
      [this.traceContextFieldName]: carrier,
    };
  }

  wrapExecution<T>(ctx: OutboxEventContext, next: () => Promise<T>): Promise<T> {
    const parentContext = this.extractParentContext(ctx.eventPayload);

    return this.tracer.startActiveSpan(
      `outbox.process ${ctx.eventName}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'outbox.event_id': ctx.eventId,
          'outbox.event_name': ctx.eventName,
          'outbox.listener': ctx.listenerName,
        },
      },
      parentContext,
      async (span) => {
        try {
          const result = await next();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private extractParentContext(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return context.active();
    }

    const carrier = (payload as Record<string, unknown>)[
      this.traceContextFieldName
    ] as TraceContextCarrier | undefined;

    if (!carrier || typeof carrier !== 'object') {
      return context.active();
    }

    return propagation.extract(context.active(), carrier);
  }
}
