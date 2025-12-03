import { ConfigurableModuleBuilder } from '@nestjs/common';
import { DatabaseDriverFactory } from './driver/database-driver.factory';

export interface InboxOutboxModuleEventOptions {
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

export interface InboxOutboxModuleOptions {
  events: InboxOutboxModuleEventOptions[];
  retryEveryMilliseconds: number;
  maxInboxOutboxTransportEventPerRetry: number;
  driverFactory: DatabaseDriverFactory;
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<InboxOutboxModuleOptions>()
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
