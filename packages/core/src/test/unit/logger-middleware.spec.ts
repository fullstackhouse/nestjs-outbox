import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { LoggerMiddleware } from '../../middleware/logger.middleware';
import { OutboxEventContext, OutboxListenerResult } from '../../middleware/outbox-middleware.interface';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => ({
      log: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let mockLogger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const createContext = (overrides?: Partial<OutboxEventContext>): OutboxEventContext => ({
    eventName: 'TestEvent',
    eventPayload: { data: 'test' },
    eventId: 123,
    listenerName: 'TestListener',
    ...overrides,
  });

  beforeEach(() => {
    middleware = new LoggerMiddleware();
    mockLogger = (middleware as any).logger;
  });

  describe('beforeProcess', () => {
    it('should log OUTBOX START with context', () => {
      const context = createContext();

      middleware.beforeProcess(context);

      expect(mockLogger.log).toHaveBeenCalledWith('OUTBOX START TestEvent', {
        eventId: 123,
        listener: 'TestListener',
        payload: '{"data":"test"}',
      });
    });

    it('should truncate long payloads', () => {
      const longPayload = { data: 'x'.repeat(300) };
      const context = createContext({ eventPayload: longPayload });

      middleware.beforeProcess(context);

      const logCall = mockLogger.log.mock.calls[0];
      expect(logCall[1].payload.length).toBeLessThanOrEqual(203);
      expect(logCall[1].payload).toMatch(/\.\.\.$/);
    });
  });

  describe('afterProcess', () => {
    it('should log OUTBOX END on success', () => {
      const context = createContext();
      const result: OutboxListenerResult = {
        success: true,
        durationMs: 42,
      };

      middleware.afterProcess(context, result);

      expect(mockLogger.log).toHaveBeenCalledWith('OUTBOX END   TestEvent', {
        eventId: 123,
        listener: 'TestListener',
        payload: '{"data":"test"}',
        processTime: 42,
      });
    });

    it('should log OUTBOX FAIL on failure', () => {
      const context = createContext();
      const result: OutboxListenerResult = {
        success: false,
        error: new Error('Something went wrong'),
        durationMs: 10,
      };

      middleware.afterProcess(context, result);

      expect(mockLogger.error).toHaveBeenCalledWith('OUTBOX FAIL  TestEvent', {
        eventId: 123,
        listener: 'TestListener',
        payload: '{"data":"test"}',
        processTime: 10,
        error: 'Something went wrong',
      });
    });

    it('should handle missing error message', () => {
      const context = createContext();
      const result: OutboxListenerResult = {
        success: false,
        durationMs: 10,
      };

      middleware.afterProcess(context, result);

      expect(mockLogger.error).toHaveBeenCalledWith('OUTBOX FAIL  TestEvent', {
        eventId: 123,
        listener: 'TestListener',
        payload: '{"data":"test"}',
        processTime: 10,
        error: 'Unknown error',
      });
    });
  });
});
