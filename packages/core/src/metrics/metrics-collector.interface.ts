export interface OutboxMetricsSnapshot {
  eventsEmitted: number;
  eventsProcessed: number;
  eventsFailed: number;
  eventsSucceeded: number;
  totalProcessingTimeMs: number;
  eventsByName: Map<string, EventMetrics>;
  listenersByName: Map<string, ListenerMetrics>;
}

export interface EventMetrics {
  emitted: number;
  processed: number;
  failed: number;
  succeeded: number;
  totalProcessingTimeMs: number;
}

export interface ListenerMetrics {
  processed: number;
  failed: number;
  succeeded: number;
  totalProcessingTimeMs: number;
}

export interface MetricsCollector {
  recordEmit(eventName: string): void;
  recordProcessed(eventName: string, listenerName: string, success: boolean, durationMs: number): void;
  getSnapshot(): OutboxMetricsSnapshot;
  reset(): void;
}

export const METRICS_COLLECTOR_TOKEN = 'OUTBOX_METRICS_COLLECTOR_TOKEN';
