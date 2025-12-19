export interface TracingOutboxOptions {
  tracerName?: string;
  traceContextFieldName?: string;
}

export const DEFAULT_TRACER_NAME = 'nestjs-outbox';
export const DEFAULT_TRACE_CONTEXT_FIELD = '_traceContext';
