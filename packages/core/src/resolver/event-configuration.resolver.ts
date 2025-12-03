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
        return this.eventConfigurationsMap.get(eventName);
    }
}