import { vi } from 'vitest';

export const createMockedEventConfigurationResolver = () => {
    return {
        resolve: vi.fn(),
    }
}
