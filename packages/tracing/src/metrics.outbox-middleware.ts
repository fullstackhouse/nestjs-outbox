import { Injectable, Inject, Optional } from '@nestjs/common';
import { metrics, Counter, Histogram, Meter } from '@opentelemetry/api';
import {
  OutboxMiddleware,
  OutboxEventContext,
  OutboxListenerResult,
  OutboxEvent,
} from '@fullstackhouse/nestjs-outbox';
import { DEFAULT_TRACER_NAME } from './tracing-options.interface';

export interface MetricsOutboxOptions {
  meterName?: string;
}

export const METRICS_OUTBOX_OPTIONS = 'METRICS_OUTBOX_OPTIONS';

@Injectable()
export class MetricsOutboxMiddleware implements OutboxMiddleware {
  private readonly meter: Meter;
  private readonly eventsEmittedCounter: Counter;
  private readonly eventsProcessedCounter: Counter;
  private readonly eventsSucceededCounter: Counter;
  private readonly eventsFailedCounter: Counter;
  private readonly processingDurationHistogram: Histogram;

  constructor(
    @Optional()
    @Inject(METRICS_OUTBOX_OPTIONS)
    options?: MetricsOutboxOptions,
  ) {
    const meterName = options?.meterName ?? DEFAULT_TRACER_NAME;
    this.meter = metrics.getMeter(meterName);

    this.eventsEmittedCounter = this.meter.createCounter('outbox.events.emitted', {
      description: 'Total number of outbox events emitted',
      unit: '{event}',
    });

    this.eventsProcessedCounter = this.meter.createCounter('outbox.events.processed', {
      description: 'Total number of outbox event listener executions',
      unit: '{execution}',
    });

    this.eventsSucceededCounter = this.meter.createCounter('outbox.events.succeeded', {
      description: 'Total number of successful outbox event listener executions',
      unit: '{execution}',
    });

    this.eventsFailedCounter = this.meter.createCounter('outbox.events.failed', {
      description: 'Total number of failed outbox event listener executions',
      unit: '{execution}',
    });

    this.processingDurationHistogram = this.meter.createHistogram('outbox.processing.duration', {
      description: 'Duration of outbox event listener processing',
      unit: 'ms',
    });
  }

  beforeEmit(event: OutboxEvent): OutboxEvent {
    this.eventsEmittedCounter.add(1, {
      'outbox.event_name': event.name,
    });
    return event;
  }

  afterProcess(context: OutboxEventContext, result: OutboxListenerResult): void {
    const attributes = {
      'outbox.event_name': context.eventName,
      'outbox.listener': context.listenerName,
    };

    this.eventsProcessedCounter.add(1, attributes);
    this.processingDurationHistogram.record(result.durationMs, attributes);

    if (result.success) {
      this.eventsSucceededCounter.add(1, attributes);
    } else {
      this.eventsFailedCounter.add(1, attributes);
    }
  }
}
