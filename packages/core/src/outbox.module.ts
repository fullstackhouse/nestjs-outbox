import { DynamicModule, Logger, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DATABASE_DRIVER_FACTORY_TOKEN } from './driver/database-driver.factory';
import { TransactionalEventEmitter } from './emitter/transactional-event-emitter';
import { EventValidator } from './event-validator/event.validator';
import { OutboxEventFlusher } from './flusher/outbox-event-flusher';
import { ASYNC_OPTIONS_TYPE, ConfigurableModuleClass, OutboxModuleOptions, MODULE_OPTIONS_TOKEN } from './outbox.module-definition';
import { ListenerDiscovery } from './listener/discovery/listener.discovery';
import { DefaultMetricsCollector } from './metrics/default-metrics-collector';
import { METRICS_COLLECTOR_TOKEN } from './metrics/metrics-collector.interface';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { LoggerMiddleware } from './middleware/logger.middleware';
import { OutboxMiddleware, OUTBOX_MIDDLEWARES_TOKEN } from './middleware/outbox-middleware.interface';
import { EVENT_LISTENER_TOKEN } from './poller/event-listener.interface';
import { RetryableOutboxEventPoller } from './poller/retryable-outbox-event.poller';
import { OUTBOX_EVENT_PROCESSOR_TOKEN } from './processor/outbox-event-processor.contract';
import { OutboxEventProcessor } from './processor/outbox-event.processor';
import { EVENT_CONFIGURATION_RESOLVER_TOKEN } from './resolver/event-configuration-resolver.contract';
import { EventConfigurationResolver } from './resolver/event-configuration.resolver';

const DEFAULT_MIDDLEWARES: Type<OutboxMiddleware>[] = [LoggerMiddleware];

@Module({
  imports: [DiscoveryModule],
  providers: [
    Logger,
    {
      provide: OUTBOX_EVENT_PROCESSOR_TOKEN,
      useClass: OutboxEventProcessor,
    },
    {
      provide: EVENT_CONFIGURATION_RESOLVER_TOKEN,
      useFactory: (options: OutboxModuleOptions) => {
        return new EventConfigurationResolver(options);
      },
      inject: [MODULE_OPTIONS_TOKEN],
    },
    TransactionalEventEmitter,
    RetryableOutboxEventPoller,
    ListenerDiscovery,
    EventConfigurationResolver,
    EventValidator,
    OutboxEventFlusher,
  ],
  exports: [TransactionalEventEmitter, OutboxEventFlusher],
})
export class OutboxModule extends ConfigurableModuleClass {
  static registerAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const registered = super.registerAsync(options);
    const enableDefaultMiddlewares = options.enableDefaultMiddlewares ?? true;
    const enableMetrics = options.enableMetrics ?? false;
    const defaultMiddlewares = enableDefaultMiddlewares ? DEFAULT_MIDDLEWARES : [];
    const metricsMiddlewares = enableMetrics ? [MetricsMiddleware] : [];
    const middlewares = [...defaultMiddlewares, ...metricsMiddlewares, ...(options.middlewares ?? [])];

    const metricsProviders: Provider[] = enableMetrics
      ? [
          {
            provide: METRICS_COLLECTOR_TOKEN,
            useValue: options.metricsCollector ?? new DefaultMetricsCollector(),
          } as Provider,
          MetricsMiddleware,
        ]
      : [];

    const exports = [TransactionalEventEmitter, OutboxEventFlusher];
    if (enableMetrics) {
      exports.push(METRICS_COLLECTOR_TOKEN as any);
    }

    return {
      ...registered,
      global: options.isGlobal,
      imports: [...registered.imports],
      providers: [
        ...registered.providers,
        ...metricsProviders,
        ...defaultMiddlewares,
        ...(options.middlewares ?? []),
        {
          provide: DATABASE_DRIVER_FACTORY_TOKEN,
          useFactory: async (moduleOptions: OutboxModuleOptions) => {
            return moduleOptions.driverFactory;
          },
          inject: [MODULE_OPTIONS_TOKEN],
        } as Provider<any>,
        {
          provide: EVENT_LISTENER_TOKEN,
          useFactory: async (moduleOptions: OutboxModuleOptions) => {
            return moduleOptions.driverFactory.getEventListener?.() ?? null;
          },
          inject: [MODULE_OPTIONS_TOKEN],
        } as Provider<any>,
        {
          provide: OUTBOX_MIDDLEWARES_TOKEN,
          useFactory: (...instances: OutboxMiddleware[]) => instances,
          inject: middlewares,
        } as Provider<any>,
      ],
      exports,
    };
  }
}
