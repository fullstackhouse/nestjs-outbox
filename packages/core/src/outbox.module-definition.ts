import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import { DatabaseDriverFactory } from './driver/database-driver.factory';
import { OutboxExceptionFilter } from './filter/outbox-exception-filter.interface';
import { OutboxMiddleware } from './middleware/outbox-middleware.interface';

export interface OutboxModuleEventOptions {
  name: string;
  listeners: {
    expiresAtTTL: number;
    readyToRetryAfterTTL: number;
    maxExecutionTimeTTL: number;
  };
  /**
   * Whether to immediately process the event after saving to DB.
   * When true (default), events are saved and immediately delivered to listeners.
   * When false, events are only saved to DB and processed later by the poller.
   * Use false for "fire and forget" pattern that's safer for crash recovery.
   * @default true
   */
  immediateProcessing?: boolean;
}

export interface OutboxModuleOptions {
  events: OutboxModuleEventOptions[];
  retryEveryMilliseconds: number;
  maxOutboxTransportEventPerRetry: number;
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
      /**
       * Exception filter classes for handling outbox processing errors.
       * Classes are registered as providers and instantiated via NestJS DI.
       * Filters receive errors after middleware onError hooks, enabling
       * integration with error reporting services (e.g., Sentry via @SentryExceptionCaptured()).
       */
      exceptionFilters: [] as Type<OutboxExceptionFilter>[],
    },
    (definition, extras) => ({
      ...definition,
      global: extras.isGlobal,
    }),
  )
  .build();
