import { DatabaseDriverFactory } from "../../../driver/database-driver.factory";
import { RetryStrategy } from "../../../outbox.module-definition";

export const createMockedOutboxOptionsFactory = (mockedDriverFactory: DatabaseDriverFactory, events: {
    name: string,
    listeners: {
        retentionPeriod: number,
        retryStrategy?: RetryStrategy,
        maxRetries?: number,
        maxExecutionTime: number
    }
}[]) => ({
    driverFactory: mockedDriverFactory,
    pollingInterval: 1000,
    maxEventsPerPoll: 1000,
    events
});
