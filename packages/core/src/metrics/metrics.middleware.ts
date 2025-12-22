import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent } from '../emitter/contract/outbox-event.interface';
import {
  OutboxEventContext,
  OutboxListenerResult,
  OutboxMiddleware,
} from '../middleware/outbox-middleware.interface';
import { MetricsCollector, METRICS_COLLECTOR_TOKEN } from './metrics-collector.interface';

@Injectable()
export class MetricsMiddleware implements OutboxMiddleware {
  constructor(
    @Inject(METRICS_COLLECTOR_TOKEN)
    private readonly metricsCollector: MetricsCollector,
  ) {}

  beforeEmit(event: OutboxEvent): OutboxEvent {
    this.metricsCollector.recordEmit(event.name);
    return event;
  }

  afterProcess(context: OutboxEventContext, result: OutboxListenerResult): void {
    this.metricsCollector.recordProcessed(
      context.eventName,
      context.listenerName,
      result.success,
      result.durationMs,
    );
  }
}
