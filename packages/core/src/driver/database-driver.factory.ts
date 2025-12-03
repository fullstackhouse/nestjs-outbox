import { EventListener } from "../poller/event-listener.interface";
import { EventConfigurationResolverContract } from "../resolver/event-configuration-resolver.contract";
import { DatabaseDriver } from "./database.driver";

export const DATABASE_DRIVER_FACTORY_TOKEN = 'DATABASE_DRIVER_FACTORY_TOKEN';

export interface DatabaseDriverFactory {
    create(eventConfigurationResolver: EventConfigurationResolverContract): DatabaseDriver;
    getEventListener?(): EventListener | null;
}