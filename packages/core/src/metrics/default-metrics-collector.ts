import { Injectable } from '@nestjs/common';
import {
  EventMetrics,
  ListenerMetrics,
  MetricsCollector,
  OutboxMetricsSnapshot,
} from './metrics-collector.interface';

@Injectable()
export class DefaultMetricsCollector implements MetricsCollector {
  private eventsEmitted = 0;
  private eventsProcessed = 0;
  private eventsFailed = 0;
  private eventsSucceeded = 0;
  private totalProcessingTimeMs = 0;
  private eventsByName = new Map<string, EventMetrics>();
  private listenersByName = new Map<string, ListenerMetrics>();

  recordEmit(eventName: string): void {
    this.eventsEmitted++;
    const eventMetrics = this.getOrCreateEventMetrics(eventName);
    eventMetrics.emitted++;
  }

  recordProcessed(eventName: string, listenerName: string, success: boolean, durationMs: number): void {
    this.eventsProcessed++;
    this.totalProcessingTimeMs += durationMs;

    if (success) {
      this.eventsSucceeded++;
    } else {
      this.eventsFailed++;
    }

    const eventMetrics = this.getOrCreateEventMetrics(eventName);
    eventMetrics.processed++;
    eventMetrics.totalProcessingTimeMs += durationMs;
    if (success) {
      eventMetrics.succeeded++;
    } else {
      eventMetrics.failed++;
    }

    const listenerMetrics = this.getOrCreateListenerMetrics(listenerName);
    listenerMetrics.processed++;
    listenerMetrics.totalProcessingTimeMs += durationMs;
    if (success) {
      listenerMetrics.succeeded++;
    } else {
      listenerMetrics.failed++;
    }
  }

  getSnapshot(): OutboxMetricsSnapshot {
    return {
      eventsEmitted: this.eventsEmitted,
      eventsProcessed: this.eventsProcessed,
      eventsFailed: this.eventsFailed,
      eventsSucceeded: this.eventsSucceeded,
      totalProcessingTimeMs: this.totalProcessingTimeMs,
      eventsByName: new Map(this.eventsByName),
      listenersByName: new Map(this.listenersByName),
    };
  }

  reset(): void {
    this.eventsEmitted = 0;
    this.eventsProcessed = 0;
    this.eventsFailed = 0;
    this.eventsSucceeded = 0;
    this.totalProcessingTimeMs = 0;
    this.eventsByName.clear();
    this.listenersByName.clear();
  }

  private getOrCreateEventMetrics(eventName: string): EventMetrics {
    let metrics = this.eventsByName.get(eventName);
    if (!metrics) {
      metrics = { emitted: 0, processed: 0, failed: 0, succeeded: 0, totalProcessingTimeMs: 0 };
      this.eventsByName.set(eventName, metrics);
    }
    return metrics;
  }

  private getOrCreateListenerMetrics(listenerName: string): ListenerMetrics {
    let metrics = this.listenersByName.get(listenerName);
    if (!metrics) {
      metrics = { processed: 0, failed: 0, succeeded: 0, totalProcessingTimeMs: 0 };
      this.listenersByName.set(listenerName, metrics);
    }
    return metrics;
  }
}
