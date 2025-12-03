import { MikroORM } from '@mikro-orm/core';
import { DatabaseDriver, EventConfigurationResolverContract, EventListener } from '@nestixis/nestjs-inbox-outbox';
import { PostgreSQLEventListener, PostgreSQLEventListenerOptions } from '../listener/postgresql-event-listener';
import { MikroORMDatabaseDriver } from './mikroorm.database-driver';

export interface MikroORMDatabaseDriverFactoryOptions {
  listenNotify?: PostgreSQLEventListenerOptions & { enabled?: boolean };
}

export class MikroORMDatabaseDriverFactory {
  private eventListener: PostgreSQLEventListener | null = null;

  constructor(
    private readonly orm: MikroORM,
    options?: MikroORMDatabaseDriverFactoryOptions,
  ) {
    if (options?.listenNotify?.enabled !== false) {
      this.eventListener = new PostgreSQLEventListener(orm, options?.listenNotify);
    }
  }

  create(eventConfigurationResolver: EventConfigurationResolverContract): DatabaseDriver {
    const forkedEm = this.orm.em.fork();
    return new MikroORMDatabaseDriver(forkedEm, eventConfigurationResolver);
  }

  getEventListener(): EventListener | null {
    return this.eventListener;
  }
}
