import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import { DatabaseDriverFactory } from './driver/database-driver.factory';
import { DeadLetterHandler, OutboxMiddleware } from './middleware/outbox-middleware.interface';

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
    dlqHandler?: DeadLetterHandler;
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
