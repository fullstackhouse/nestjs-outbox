import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MetricsMiddleware } from '../../metrics/metrics.middleware';
import { MetricsCollector } from '../../metrics/metrics-collector.interface';
import { OutboxEventContext, OutboxListenerResult } from '../../middleware/outbox-middleware.interface';

describe('MetricsMiddleware', () => {
  let middleware: MetricsMiddleware;
  let mockCollector: MetricsCollector;

  const createContext = (overrides?: Partial<OutboxEventContext>): OutboxEventContext => ({
    eventName: 'TestEvent',
    eventPayload: { data: 'test' },
    eventId: 123,
    listenerName: 'TestListener',
    ...overrides,
  });

  beforeEach(() => {
    mockCollector = {
      recordEmit: vi.fn(),
      recordProcessed: vi.fn(),
      getSnapshot: vi.fn(),
      reset: vi.fn(),
    };
    middleware = new MetricsMiddleware(mockCollector);
  });

  describe('beforeEmit', () => {
    it('should record emit with event name', () => {
      const event = { name: 'OrderCreated', payload: { orderId: 1 } };

      const result = middleware.beforeEmit(event);

      expect(mockCollector.recordEmit).toHaveBeenCalledWith('OrderCreated');
      expect(result).toBe(event);
    });

    it('should return the event unchanged', () => {
      const event = { name: 'UserRegistered', payload: { userId: 42 } };

      const result = middleware.beforeEmit(event);

      expect(result).toEqual(event);
    });
  });

  describe('afterProcess', () => {
    it('should record successful processing', () => {
      const context = createContext({ eventName: 'OrderCreated', listenerName: 'NotifyShipping' });
      const result: OutboxListenerResult = { success: true, durationMs: 50 };

      middleware.afterProcess(context, result);

      expect(mockCollector.recordProcessed).toHaveBeenCalledWith(
        'OrderCreated',
        'NotifyShipping',
        true,
        50,
      );
    });

    it('should record failed processing', () => {
      const context = createContext({ eventName: 'PaymentFailed', listenerName: 'RefundHandler' });
      const result: OutboxListenerResult = {
        success: false,
        error: new Error('Payment gateway timeout'),
        durationMs: 3000,
      };

      middleware.afterProcess(context, result);

      expect(mockCollector.recordProcessed).toHaveBeenCalledWith(
        'PaymentFailed',
        'RefundHandler',
        false,
        3000,
      );
    });
  });
});
