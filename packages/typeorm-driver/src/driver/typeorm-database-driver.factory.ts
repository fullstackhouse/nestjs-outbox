import { DatabaseDriver, EventConfigurationResolverContract, EventListener } from '@nestixis/nestjs-inbox-outbox';
import { DataSource } from 'typeorm';
import { TypeORMDatabaseDriver } from './typeorm.database-driver';

export class TypeORMDatabaseDriverFactory {
  constructor(private readonly dataSource: DataSource) {}

  create(eventConfigurationResolver: EventConfigurationResolverContract): DatabaseDriver {
    return new TypeORMDatabaseDriver(this.dataSource, eventConfigurationResolver);
  }

  getEventListener(): EventListener | null {
    return null;
  }
}
