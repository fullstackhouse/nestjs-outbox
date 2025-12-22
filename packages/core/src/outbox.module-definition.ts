import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import { DatabaseDriverFactory } from './driver/database-driver.factory';
import { MetricsCollector } from './metrics/metrics-collector.interface';
import { OutboxMiddleware } from './middleware/outbox-middleware.interface';

export type RetryStrategy = (retryCount: number) => number;

export const defaultRetryStrategy: RetryStrategy = (retryCount: number) => {
  const baseDelayMs = 1000;
  const maxDelayMs = 60_000;
  const delay = Math.min(baseDelayMs * Math.pow(2, retryCount), maxDelayMs);
  return delay;
};

export interface OutboxModuleEventOptions {
  name: string;
  listeners: {
    retentionPeriod: number;
    retryStrategy?: RetryStrategy;
    maxRetries?: number;
    maxExecutionTime: number;
  };
}

export interface OutboxModuleOptions {
  events: OutboxModuleEventOptions[];
  pollingInterval: number;
  maxEventsPerPoll: number;
  driverFactory: DatabaseDriverFactory;
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<OutboxModuleOptions>()
  .setExtras(
    {
      isGlobal: true,
      /**
       * Whether to enable default middlewares (LoggerMiddleware).
       * @default true
       */
      enableDefaultMiddlewares: true,
      /**
       * Whether to enable built-in metrics collection.
       * When enabled, a DefaultMetricsCollector is registered and MetricsMiddleware is added.
       * @default false
       */
      enableMetrics: false,
      /**
       * Custom metrics collector instance.
       * Only used when enableMetrics is true.
       * If not provided, DefaultMetricsCollector is used.
       */
      metricsCollector: undefined as MetricsCollector | undefined,
      /**
       * Middleware classes for event processing hooks.
       * Classes are registered as providers and instantiated via NestJS DI.
       */
      middlewares: [] as Type<OutboxMiddleware>[],
    },
    (definition, extras) => ({
      ...definition,
      global: extras.isGlobal,
    }),
  )
  .build();
