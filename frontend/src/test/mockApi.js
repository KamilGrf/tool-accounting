// Replaces src/api/index.js in page tests: every function is a vi.fn() with a sensible default.
// Usage in a test file:
//   vi.mock('../api/index.js', async () => (await import('../test/mockApi.js')).api);
//   beforeEach(resetApi);
import { vi } from 'vitest';
import { ApiError } from '../api/client.js';

export const TOOLS = [
    { id: 1, inv_number: 'ИНВ-0001', name: 'Дрель ударная Bosch GSB 13 RE', category: 'Электроинструмент', category_id: 1, manufacturer: 'Bosch', price: 5200, status: 'issued', location: 'Склад А', note: null },
    { id: 2, inv_number: 'ИНВ-0002', name: 'Шуруповёрт Makita DF330D', category: 'Электроинструмент', category_id: 1, manufacturer: 'Makita', price: 6900, status: 'in_stock', location: 'Склад А', note: null },
];
export const EMPLOYEES = [{ id: 1, full_name: 'Иванов Пётр Сергеевич', department: 'Ремонтный цех' }];
export const CATEGORIES = [{ id: 1, name: 'Электроинструмент', tools_count: 2 }];

export const api = {
    isConfigured: true,
    authApi: {},
    toolsApi: {},
    issuesApi: {},
    employeesApi: {},
    categoriesApi: {},
    statsApi: {},
};

/** Fresh mocks: nobody is signed in, lists return the fixtures above. Call it in beforeEach. */
export function resetApi() {
    api.isConfigured = true;
    Object.assign(api.authApi, {
        me: vi.fn(async () => { throw new ApiError(401, 'Требуется вход'); }),
        login: vi.fn(async () => ({ id: 'u1', login: 'ivan@test.ru', role: 'storekeeper' })),
        register: vi.fn(async () => ({ id: 'u1', login: 'ivan@test.ru', role: 'storekeeper' })),
        logout: vi.fn(async () => {}),
        onSessionEnd: vi.fn(() => () => {}),
    });
    Object.assign(api.toolsApi, {
        list: vi.fn(async () => TOOLS),
        create: vi.fn(async (body) => ({ id: 99, ...body })),
        update: vi.fn(async (id, body) => ({ id, ...body })),
    });
    Object.assign(api.issuesApi, {
        list: vi.fn(async () => []),
        issue: vi.fn(async () => ({ id: 1 })),
        returnTool: vi.fn(async () => ({ id: 1 })),
        extend: vi.fn(async () => ({ id: 1 })),
        overdueCsv: vi.fn(async () => ''),
    });
    Object.assign(api.employeesApi, { list: vi.fn(async () => EMPLOYEES) });
    Object.assign(api.categoriesApi, { list: vi.fn(async () => CATEGORIES) });
    Object.assign(api.statsApi, { get: vi.fn(async () => ({})), usage: vi.fn(async () => []) });
}

resetApi();
