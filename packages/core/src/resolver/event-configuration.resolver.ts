import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { InboxOutboxModuleEventOptions, InboxOutboxModuleOptions, MODULE_OPTIONS_TOKEN } from "../inbox-outbox.module-definition";

@Injectable()
export class EventConfigurationResolver implements OnModuleInit {

    private readonly eventConfigurationsMap: Map<string, InboxOutboxModuleEventOptions> = new Map();

    constructor(@Inject(MODULE_OPTIONS_TOKEN) private options: InboxOutboxModuleOptions) {}

    onModuleInit() {
        this.options.events.forEach(event => {
            this.eventConfigurationsMap.set(event.name, event);
        });
    }

    resolve(eventName: string): InboxOutboxModuleEventOptions {
        const config = this.eventConfigurationsMap.get(eventName);
        if (!config) {
            throw new Error(`Event configuration not found for event: ${eventName}`);
        }
        return config;
    }
}