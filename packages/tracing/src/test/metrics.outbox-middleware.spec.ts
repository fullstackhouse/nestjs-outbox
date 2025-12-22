import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsOutboxMiddleware } from '../metrics.outbox-middleware';
import { OutboxEventContext, OutboxListenerResult } from '@fullstackhouse/nestjs-outbox';

const mockCounter = {
  add: vi.fn(),
};

const mockHistogram = {
  record: vi.fn(),
};

const mockMeter = {
  createCounter: vi.fn(() => mockCounter),
  createHistogram: vi.fn(() => mockHistogram),
};

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => mockMeter),
  },
}));

describe('MetricsOutboxMiddleware', () => {
  let middleware: MetricsOutboxMiddleware;

  const createContext = (overrides?: Partial<OutboxEventContext>): OutboxEventContext => ({
    eventName: 'TestEvent',
    eventPayload: { data: 'test' },
    eventId: 123,
    listenerName: 'TestListener',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new MetricsOutboxMiddleware();
  });

  describe('constructor', () => {
    it('creates counter and histogram instruments', () => {
      expect(mockMeter.createCounter).toHaveBeenCalledWith('outbox.events.emitted', expect.any(Object));
      expect(mockMeter.createCounter).toHaveBeenCalledWith('outbox.events.processed', expect.any(Object));
      expect(mockMeter.createCounter).toHaveBeenCalledWith('outbox.events.succeeded', expect.any(Object));
      expect(mockMeter.createCounter).toHaveBeenCalledWith('outbox.events.failed', expect.any(Object));
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('outbox.processing.duration', expect.any(Object));
    });

    it('uses custom meter name when provided', async () => {
      const { metrics } = await import('@opentelemetry/api');
      vi.clearAllMocks();

      new MetricsOutboxMiddleware({ meterName: 'my-custom-meter' });

      expect(metrics.getMeter).toHaveBeenCalledWith('my-custom-meter');
    });
  });

  describe('beforeEmit', () => {
    it('increments emitted counter with event name', () => {
      const event = { name: 'OrderCreated', payload: { orderId: 1 } };

      const result = middleware.beforeEmit(event);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        'outbox.event_name': 'OrderCreated',
      });
      expect(result).toBe(event);
    });
  });

  describe('afterProcess', () => {
    it('records metrics for successful processing', () => {
      const context = createContext({ eventName: 'OrderCreated', listenerName: 'NotifyShipping' });
      const result: OutboxListenerResult = { success: true, durationMs: 50 };

      middleware.afterProcess(context, result);

      const expectedAttributes = {
        'outbox.event_name': 'OrderCreated',
        'outbox.listener': 'NotifyShipping',
      };

      expect(mockCounter.add).toHaveBeenCalledWith(1, expectedAttributes);
      expect(mockHistogram.record).toHaveBeenCalledWith(50, expectedAttributes);
    });

    it('increments succeeded counter on success', () => {
      const context = createContext();
      const result: OutboxListenerResult = { success: true, durationMs: 100 };

      middleware.afterProcess(context, result);

      expect(mockCounter.add).toHaveBeenCalledTimes(2);
    });

    it('increments failed counter on failure', () => {
      const context = createContext();
      const result: OutboxListenerResult = {
        success: false,
        error: new Error('Something went wrong'),
        durationMs: 200,
      };

      middleware.afterProcess(context, result);

      expect(mockCounter.add).toHaveBeenCalledTimes(2);
    });
  });
});
