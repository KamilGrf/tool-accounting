import { vi } from 'vitest';

export const TOOLS = [
    { id: 1, inv_number: 'ИНВ-0001', name: 'Дрель ударная Bosch GSB 13 RE', category: 'Электроинструмент', category_id: 1, manufacturer: 'Bosch', price: 5200, status: 'issued', location: 'Склад А', note: null },
    { id: 2, inv_number: 'ИНВ-0002', name: 'Шуруповёрт Makita DF330D', category: 'Электроинструмент', category_id: 1, manufacturer: 'Makita', price: 6900, status: 'in_stock', location: 'Склад А', note: null },
];
export const EMPLOYEES = [{ id: 1, full_name: 'Иванов Пётр Сергеевич', department: 'Ремонтный цех' }];
export const CATEGORIES = [{ id: 1, name: 'Электроинструмент', tools_count: 2 }];

const json = (status, data) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
});

/**
 * Install a fake fetch. `handlers` maps "METHOD /path" (without query) to either a
 * response ({status, data}) or a function (url, init) => response. Unlisted routes -> 404.
 */
export function mockFetch(handlers = {}) {
    const calls = [];
    const fn = vi.fn(async (url, init = {}) => {
        const method = init.method || 'GET';
        const path = url.split('?')[0];
        calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
        const h = handlers[`${method} ${path}`];
        if (!h) return json(404, { error: 'Ресурс не найден' });
        const res = typeof h === 'function' ? await h(url, init) : h;
        if (res instanceof Error) throw res;
        return json(res.status ?? 200, res.data ?? null);
    });
    vi.stubGlobal('fetch', fn);
    return { calls, fn };
}

export const baseHandlers = () => ({
    'GET /api/tools': { data: TOOLS },
    'GET /api/categories': { data: CATEGORIES },
    'GET /api/employees': { data: EMPLOYEES },
    'GET /api/issues': { data: [] },
});
