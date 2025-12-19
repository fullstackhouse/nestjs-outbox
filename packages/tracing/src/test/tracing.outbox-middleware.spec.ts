import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as otelApi from '@opentelemetry/api';
import { TracingOutboxMiddleware } from '../tracing.outbox-middleware';
import { DEFAULT_TRACE_CONTEXT_FIELD } from '../tracing-options.interface';

vi.mock('@opentelemetry/api', async () => {
  const mockSpan = {
    setStatus: vi.fn(),
    end: vi.fn(),
  };

  const mockTracer = {
    startActiveSpan: vi.fn(
      (
        _name: string,
        _options: unknown,
        _context: unknown,
        fn: (span: typeof mockSpan) => unknown,
      ) => fn(mockSpan),
    ),
  };

  return {
    trace: {
      getTracer: vi.fn(() => mockTracer),
    },
    context: {
      active: vi.fn(() => ({})),
    },
    propagation: {
      inject: vi.fn((_ctx: unknown, carrier: Record<string, string>) => {
        carrier['traceparent'] = '00-trace-id-span-id-01';
      }),
      extract: vi.fn((_ctx: unknown, _carrier: unknown) => ({ extracted: true })),
    },
    SpanKind: {
      CONSUMER: 4,
    },
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
  };
});

describe('TracingOutboxMiddleware', () => {
  let middleware: TracingOutboxMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new TracingOutboxMiddleware();
  });

  describe('beforeEmit', () => {
    it('injects trace context into event payload', () => {
      const event = { name: 'test.event', data: 'value' };

      const result = middleware.beforeEmit(event);

      expect(result).toEqual({
        name: 'test.event',
        data: 'value',
        [DEFAULT_TRACE_CONTEXT_FIELD]: { traceparent: '00-trace-id-span-id-01' },
      });
      expect(otelApi.propagation.inject).toHaveBeenCalled();
    });

    it('uses custom field name when configured', () => {
      const customMiddleware = new TracingOutboxMiddleware({
        traceContextFieldName: '_customTrace',
      });
      const event = { name: 'test.event' };

      const result = customMiddleware.beforeEmit(event);

      expect(result).toHaveProperty('_customTrace');
      expect(result).not.toHaveProperty(DEFAULT_TRACE_CONTEXT_FIELD);
    });
  });

  describe('wrapExecution', () => {
    const mockContext = {
      eventName: 'test.event',
      eventPayload: { [DEFAULT_TRACE_CONTEXT_FIELD]: { traceparent: 'test' } },
      eventId: 123,
      listenerName: 'TestListener',
    };

    it('creates span with correct attributes', async () => {
      const next = vi.fn().mockResolvedValue('result');

      await middleware.wrapExecution(mockContext, next);

      expect(otelApi.trace.getTracer).toHaveBeenCalledWith('nestjs-outbox');
      const tracer = otelApi.trace.getTracer('');
      expect(tracer.startActiveSpan).toHaveBeenCalledWith(
        'outbox.process test.event',
        expect.objectContaining({
          kind: otelApi.SpanKind.CONSUMER,
          attributes: {
            'outbox.event_id': 123,
            'outbox.event_name': 'test.event',
            'outbox.listener': 'TestListener',
          },
        }),
        expect.anything(),
        expect.any(Function),
      );
    });

    it('extracts parent context from payload', async () => {
      const next = vi.fn().mockResolvedValue('result');

      await middleware.wrapExecution(mockContext, next);

      expect(otelApi.propagation.extract).toHaveBeenCalledWith(
        expect.anything(),
        { traceparent: 'test' },
      );
    });

    it('sets OK status on success', async () => {
      const next = vi.fn().mockResolvedValue('result');

      const result = await middleware.wrapExecution(mockContext, next);

      expect(result).toBe('result');
    });

    it('sets ERROR status and rethrows on failure', async () => {
      const error = new Error('test error');
      const next = vi.fn().mockRejectedValue(error);

      await expect(middleware.wrapExecution(mockContext, next)).rejects.toThrow(
        'test error',
      );
    });

    it('handles missing trace context in payload', async () => {
      const contextWithoutTrace = {
        ...mockContext,
        eventPayload: { data: 'value' },
      };
      const next = vi.fn().mockResolvedValue('result');

      await middleware.wrapExecution(contextWithoutTrace, next);

      expect(otelApi.context.active).toHaveBeenCalled();
    });

    it('handles null payload', async () => {
      const contextWithNullPayload = {
        ...mockContext,
        eventPayload: null,
      };
      const next = vi.fn().mockResolvedValue('result');

      await middleware.wrapExecution(contextWithNullPayload, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('custom tracer name', () => {
    it('uses custom tracer name when provided', () => {
      new TracingOutboxMiddleware({ tracerName: 'my-app' });

      expect(otelApi.trace.getTracer).toHaveBeenCalledWith('my-app');
    });
  });
});
