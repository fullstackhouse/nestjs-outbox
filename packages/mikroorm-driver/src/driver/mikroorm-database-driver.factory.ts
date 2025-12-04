import { MikroORM } from '@mikro-orm/core';
import { DatabaseDriver, EventConfigurationResolverContract, EventListener } from '@nestixis/nestjs-inbox-outbox';
import { PostgreSQLEventListener, PostgreSQLEventListenerOptions } from '../listener/postgresql-event-listener';
import { MikroORMDatabaseDriver } from './mikroorm.database-driver';

export interface MikroORMDatabaseDriverFactoryOptions {
  listenNotify?: PostgreSQLEventListenerOptions & { enabled?: boolean };
  /**
   * When true, uses the current transactional context (via AsyncLocalStorage)
   * instead of forking a new EntityManager. This enables compatibility with
   * MikroORM's @Transactional() decorator.
   * @default false
   */
  useContext?: boolean;
}

function isPostgreSQLDriver(orm: MikroORM): boolean {
  const driverName = orm.config.get('driver')?.name;
  return driverName === 'PostgreSqlDriver';
}

export class MikroORMDatabaseDriverFactory {
  private eventListener: PostgreSQLEventListener | null = null;
  private useContext: boolean;

  constructor(
    private readonly orm: MikroORM,
    options?: MikroORMDatabaseDriverFactoryOptions,
  ) {
    if (options?.listenNotify?.enabled !== false && isPostgreSQLDriver(orm)) {
      this.eventListener = new PostgreSQLEventListener(orm, options?.listenNotify);
    }
    this.useContext = options?.useContext ?? false;
  }

  create(eventConfigurationResolver: EventConfigurationResolverContract): DatabaseDriver {
    const em = this.useContext ? this.orm.em.getContext() : this.orm.em.fork();
    return new MikroORMDatabaseDriver(em, eventConfigurationResolver, {
      clearAfterFlush: !this.useContext,
    });
  }

  getEventListener(): EventListener | null {
    return this.eventListener;
  }
}
