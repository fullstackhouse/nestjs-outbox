import { ExceptionFilter, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DATABASE_DRIVER_FACTORY_TOKEN, DatabaseDriverFactory } from '../driver/database-driver.factory';
import { OutboxHost } from '../filter/outbox-arguments-host';
import { OutboxModuleEventOptions } from '../outbox.module-definition';
import { IListener } from '../listener/contract/listener.interface';
import { OutboxTransportEvent } from '../model/outbox-transport-event.interface';
import { EVENT_CONFIGURATION_RESOLVER_TOKEN, EventConfigurationResolverContract } from '../resolver/event-configuration-resolver.contract';
import { OutboxEventProcessorContract } from './outbox-event-processor.contract';
import {
  OutboxMiddleware,
  OutboxEventContext,
  OutboxListenerResult,
  OUTBOX_MIDDLEWARES_TOKEN,
  createOutboxEventContext,
} from '../middleware/outbox-middleware.interface';

@Injectable()
export class OutboxEventProcessor implements OutboxEventProcessorContract {
  constructor(
    @Inject(Logger) private logger: Logger,
    @Inject(DATABASE_DRIVER_FACTORY_TOKEN) private databaseDriverFactory: DatabaseDriverFactory,
    @Inject(EVENT_CONFIGURATION_RESOLVER_TOKEN) private eventConfigurationResolver: EventConfigurationResolverContract,
    @Optional() @Inject(OUTBOX_MIDDLEWARES_TOKEN) private middlewares: OutboxMiddleware[] = [],
    @Optional() @Inject(APP_FILTER) private exceptionFilters: ExceptionFilter[] = [],
  ) {}

  async process<TPayload>(eventOptions: OutboxModuleEventOptions, outboxTransportEvent: OutboxTransportEvent, listeners: IListener<TPayload>[]) {
    const deliveredToListeners: string[] = [];
    const notDeliveredToListeners: string[] = [];

    const databaseDriver = this.databaseDriverFactory.create(this.eventConfigurationResolver);

    const listenerPromises = listeners.map((listener) => this.executeListenerWithTimeout(listener, outboxTransportEvent, eventOptions));
    const listenerPromisesResults = await Promise.allSettled(listenerPromises);

    for (const result of listenerPromisesResults) {
      if (result.status === 'fulfilled' && result.value.hasFailed) {
        notDeliveredToListeners.push(result.value.listenerName);
      }

      if (result.status === 'fulfilled' && !result.value.hasFailed) {
        deliveredToListeners.push(result.value.listenerName);
      }
    }

    if (deliveredToListeners.length > 0) {
      outboxTransportEvent.deliveredToListeners.push(...deliveredToListeners);
      await databaseDriver.persist(outboxTransportEvent);
    }

    if (notDeliveredToListeners.length === 0) {
      await databaseDriver.remove(outboxTransportEvent);
    }

    return databaseDriver.flush();
  }

  private executeListenerWithTimeout(
    listener: IListener<any>,
    outboxTransportEvent: OutboxTransportEvent,
    eventOptions: OutboxModuleEventOptions,
  ): Promise<{ listenerName: string, hasFailed: boolean }> {
    return new Promise(async (resolve) => {
      let timeoutTimer: NodeJS.Timeout;
      const context = createOutboxEventContext(outboxTransportEvent, listener.getName());
      const startTime = Date.now();

      try {
        await this.invokeBeforeProcessHooks(context);

        timeoutTimer = setTimeout(async () => {
          const durationMs = Date.now() - startTime;
          const timeoutError = new Error(`Listener ${listener.getName()} has been timed out`);

          this.logger.error(
            timeoutError.message,
            this.buildEventContext(outboxTransportEvent),
          );

          await this.invokeOnErrorHooks(context, timeoutError);
          await this.invokeExceptionFilters(context, timeoutError);
          await this.invokeAfterProcessHooks(context, { success: false, error: timeoutError, durationMs });

          resolve({
            listenerName: listener.getName(),
            hasFailed: true,
          });
        }, eventOptions.listeners.maxExecutionTimeTTL);

        await this.wrapExecution(context, async () => {
          await listener.handle(outboxTransportEvent.eventPayload, outboxTransportEvent.eventName);
        });
        clearTimeout(timeoutTimer);

        const durationMs = Date.now() - startTime;
        await this.invokeAfterProcessHooks(context, { success: true, durationMs });

        resolve({
          listenerName: listener.getName(),
          hasFailed: false,
        });
      } catch (exception) {
        clearTimeout(timeoutTimer!);
        const error = exception instanceof Error ? exception : new Error(String(exception));
        const durationMs = Date.now() - startTime;

        this.logger.error(exception);

        await this.invokeOnErrorHooks(context, error);
        await this.invokeExceptionFilters(context, error);
        await this.invokeAfterProcessHooks(context, { success: false, error, durationMs });

        resolve({
          listenerName: listener.getName(),
          hasFailed: true,
        });
      }
    });
  }

  private async invokeBeforeProcessHooks(context: OutboxEventContext): Promise<void> {
    for (const middleware of this.middlewares) {
      try {
        await middleware.beforeProcess?.(context);
      } catch (error) {
        this.logger.warn(`Middleware beforeProcess hook failed: ${error}`);
      }
    }
  }

  private async invokeAfterProcessHooks(context: OutboxEventContext, result: OutboxListenerResult): Promise<void> {
    for (const middleware of this.middlewares) {
      try {
        await middleware.afterProcess?.(context, result);
      } catch (error) {
        this.logger.warn(`Middleware afterProcess hook failed: ${error}`);
      }
    }
  }

  private async invokeOnErrorHooks(context: OutboxEventContext, error: Error): Promise<void> {
    for (const middleware of this.middlewares) {
      try {
        await middleware.onError?.(context, error);
      } catch (hookError) {
        this.logger.warn(`Middleware onError hook failed: ${hookError}`);
      }
    }
  }

  private async invokeExceptionFilters(context: OutboxEventContext, error: Error): Promise<void> {
    const host = new OutboxHost(context);
    const filters = Array.isArray(this.exceptionFilters) ? this.exceptionFilters : [this.exceptionFilters].filter(Boolean);
    for (const filter of filters) {
      try {
        await filter.catch(error, host);
      } catch (filterError) {
        this.logger.warn(`Exception filter failed: ${filterError}`);
      }
    }
  }

  private async wrapExecution<T>(context: OutboxEventContext, fn: () => Promise<T>): Promise<T> {
    const wrappers = this.middlewares.filter((m) => m.wrapExecution);
    if (wrappers.length === 0) {
      return fn();
    }

    let wrapped = fn;
    for (const middleware of wrappers.reverse()) {
      const current = wrapped;
      wrapped = () => middleware.wrapExecution!(context, current);
    }
    return wrapped();
  }

  private buildEventContext(event: OutboxTransportEvent): Record<string, unknown> {
    const MAX_PAYLOAD_LENGTH = 200;
    const payloadString = JSON.stringify(event.eventPayload);
    const truncatedPayload = payloadString.length > MAX_PAYLOAD_LENGTH
      ? payloadString.substring(0, MAX_PAYLOAD_LENGTH) + '...'
      : payloadString;

    return {
      eventId: event.id,
      eventName: event.eventName,
      payload: truncatedPayload,
    };
  }
}
