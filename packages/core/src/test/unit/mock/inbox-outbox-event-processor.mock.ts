import { vi } from 'vitest';

export const createMockedInboxOutboxEventProcessor = () => {
    return {
        process: vi.fn(),
    }
}