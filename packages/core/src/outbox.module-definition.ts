import { ConfigurableModuleBuilder, Type } from '@nestjs/common';
import { DatabaseDriverFactory } from './driver/database-driver.factory';
import { OutboxHooks, OutboxMiddleware } from './middleware/outbox-middleware.interface';

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
  /**
   * Class-based middlewares for event processing hooks.
   * Middlewares are instantiated via NestJS DI and can inject dependencies.
   */
  middlewares?: Type<OutboxMiddleware>[];
  /**
   * Function-based hooks for event processing.
   * Alternative to class-based middlewares for simpler use cases.
   */
  hooks?: OutboxHooks;
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<OutboxModuleOptions>()
  .setExtras(
    {
      isGlobal: true,
    },
    (definition, extras) => ({
      ...definition,
      global: extras.isGlobal,
    }),
  )
  .build();
