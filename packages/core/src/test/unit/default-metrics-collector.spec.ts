import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultMetricsCollector } from '../../metrics/default-metrics-collector';

describe('DefaultMetricsCollector', () => {
  let collector: DefaultMetricsCollector;

  beforeEach(() => {
    collector = new DefaultMetricsCollector();
  });

  describe('recordEmit', () => {
    it('should increment eventsEmitted counter', () => {
      collector.recordEmit('OrderCreated');
      collector.recordEmit('OrderCreated');
      collector.recordEmit('UserRegistered');

      const snapshot = collector.getSnapshot();
      expect(snapshot.eventsEmitted).toBe(3);
    });

    it('should track emitted events by name', () => {
      collector.recordEmit('OrderCreated');
      collector.recordEmit('OrderCreated');
      collector.recordEmit('UserRegistered');

      const snapshot = collector.getSnapshot();
      expect(snapshot.eventsByName.get('OrderCreated')?.emitted).toBe(2);
      expect(snapshot.eventsByName.get('UserRegistered')?.emitted).toBe(1);
    });
  });

  describe('recordProcessed', () => {
    it('should increment processed counters on success', () => {
      collector.recordProcessed('OrderCreated', 'NotifyShipping', true, 50);

      const snapshot = collector.getSnapshot();
      expect(snapshot.eventsProcessed).toBe(1);
      expect(snapshot.eventsSucceeded).toBe(1);
      expect(snapshot.eventsFailed).toBe(0);
      expect(snapshot.totalProcessingTimeMs).toBe(50);
    });

    it('should increment failed counter on failure', () => {
      collector.recordProcessed('OrderCreated', 'NotifyShipping', false, 100);

      const snapshot = collector.getSnapshot();
      expect(snapshot.eventsProcessed).toBe(1);
      expect(snapshot.eventsSucceeded).toBe(0);
      expect(snapshot.eventsFailed).toBe(1);
    });

    it('should track event metrics by name', () => {
      collector.recordProcessed('OrderCreated', 'Listener1', true, 50);
      collector.recordProcessed('OrderCreated', 'Listener2', false, 100);
      collector.recordProcessed('UserRegistered', 'Listener1', true, 25);

      const snapshot = collector.getSnapshot();
      const orderMetrics = snapshot.eventsByName.get('OrderCreated');
      expect(orderMetrics?.processed).toBe(2);
      expect(orderMetrics?.succeeded).toBe(1);
      expect(orderMetrics?.failed).toBe(1);
      expect(orderMetrics?.totalProcessingTimeMs).toBe(150);

      const userMetrics = snapshot.eventsByName.get('UserRegistered');
      expect(userMetrics?.processed).toBe(1);
      expect(userMetrics?.succeeded).toBe(1);
      expect(userMetrics?.failed).toBe(0);
    });

    it('should track listener metrics by name', () => {
      collector.recordProcessed('OrderCreated', 'NotifyShipping', true, 50);
      collector.recordProcessed('UserRegistered', 'NotifyShipping', true, 30);
      collector.recordProcessed('OrderCreated', 'SendEmail', false, 100);

      const snapshot = collector.getSnapshot();
      const shippingMetrics = snapshot.listenersByName.get('NotifyShipping');
      expect(shippingMetrics?.processed).toBe(2);
      expect(shippingMetrics?.succeeded).toBe(2);
      expect(shippingMetrics?.failed).toBe(0);
      expect(shippingMetrics?.totalProcessingTimeMs).toBe(80);

      const emailMetrics = snapshot.listenersByName.get('SendEmail');
      expect(emailMetrics?.processed).toBe(1);
      expect(emailMetrics?.succeeded).toBe(0);
      expect(emailMetrics?.failed).toBe(1);
    });
  });

  describe('getSnapshot', () => {
    it('should return a copy of current metrics', () => {
      collector.recordEmit('TestEvent');
      collector.recordProcessed('TestEvent', 'Listener', true, 10);

      const snapshot1 = collector.getSnapshot();
      collector.recordEmit('TestEvent');
      const snapshot2 = collector.getSnapshot();

      expect(snapshot1.eventsEmitted).toBe(1);
      expect(snapshot2.eventsEmitted).toBe(2);
    });

    it('should return independent map copies', () => {
      collector.recordEmit('TestEvent');
      const snapshot = collector.getSnapshot();

      snapshot.eventsByName.set('Hacked', { emitted: 999, processed: 0, failed: 0, succeeded: 0, totalProcessingTimeMs: 0 });

      const freshSnapshot = collector.getSnapshot();
      expect(freshSnapshot.eventsByName.has('Hacked')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset all counters to zero', () => {
      collector.recordEmit('TestEvent');
      collector.recordProcessed('TestEvent', 'Listener', true, 100);
      collector.recordProcessed('TestEvent', 'Listener', false, 50);

      collector.reset();

      const snapshot = collector.getSnapshot();
      expect(snapshot.eventsEmitted).toBe(0);
      expect(snapshot.eventsProcessed).toBe(0);
      expect(snapshot.eventsSucceeded).toBe(0);
      expect(snapshot.eventsFailed).toBe(0);
      expect(snapshot.totalProcessingTimeMs).toBe(0);
      expect(snapshot.eventsByName.size).toBe(0);
      expect(snapshot.listenersByName.size).toBe(0);
    });
  });
});
