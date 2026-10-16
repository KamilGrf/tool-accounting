// @vitest-environment node
// Runs the REAL api/index.js against PostgREST + PostgreSQL (see supabase/tests/http.sh).
// Skipped in a normal `npm test`: it needs POSTGREST_URL and POSTGREST_JWT_SECRET.
import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The Supabase client is replaced by a PostgREST client that sends the token of the "current user".
vi.mock('./supabase.js', async () => {
    const { PostgrestClient } = await import('@supabase/postgrest-js');
    const ctx = { token: null };
    globalThis.__postgrestCtx = ctx;
    const make = () =>
        new PostgrestClient(process.env.POSTGREST_URL || 'http://127.0.0.1:1', {
            headers: ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {},
        });
    return { supabase: { from: (table) => make().from(table), rpc: (name, args) => make().rpc(name, args) }, isConfigured: true };
});

const { categoriesApi, employeesApi, issuesApi, logsApi, statsApi, toolsApi } = await import('./index.js');

const URL = process.env.POSTGREST_URL;
const SECRET = process.env.POSTGREST_JWT_SECRET;
const KEEPER = '00000000-0000-0000-0000-0000000000a1';
const BOSS = '00000000-0000-0000-0000-0000000000b1';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(sub) {
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'authenticated', aud: 'authenticated', sub, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}
const as = (sub) => {
    globalThis.__postgrestCtx.token = sub ? tokenFor(sub) : null;
};

describe.skipIf(!URL || !SECRET)('frontend API layer against PostgREST', () => {
    beforeAll(() => as(null));

    it('anonymous visitors get nothing', async () => {
        as(null);
        await expect(toolsApi.list()).rejects.toMatchObject({ status: 403, message: 'Недостаточно прав' });
        await expect(categoriesApi.list()).rejects.toMatchObject({ status: 403 });
    });

    it('a storekeeper reads the catalogue with the shapes the UI expects', async () => {
        as(KEEPER);
        const tools = await toolsApi.list();
        expect(tools).toHaveLength(14);
        expect(tools[0]).toMatchObject({ inv_number: 'ИНВ-0001', category: 'Электроинструмент', status: 'issued' });
        expect(typeof tools[0].price).toBe('number');
        expect((await toolsApi.list({ q: 'bosch' })).length).toBeGreaterThanOrEqual(1);
        expect(await toolsApi.list({ status: 'issued' })).toHaveLength(2);
        expect(await toolsApi.list({ q: '%' })).toHaveLength(0);

        const categories = await categoriesApi.list();
        expect(categories).toHaveLength(5);
        expect(typeof categories[0].tools_count).toBe('number');
        const employees = await employeesApi.list();
        expect(employees).toHaveLength(5);
        expect(typeof employees[0].active_issues).toBe('number');
    });

    it('issues: filters, overdue flag and numeric ids', async () => {
        as(KEEPER);
        expect(await issuesApi.list({ active: 1 })).toHaveLength(2);
        const overdue = await issuesApi.list({ overdue: 1 });
        expect(overdue).toHaveLength(1);
        expect(overdue[0]).toMatchObject({ tool_id: 1, overdue: 1, returned_at: null });
        expect(await issuesApi.list({ tool: 5 })).toHaveLength(1);
    });

    it('create returns the stored tool; a duplicate and bad data are explained', async () => {
        as(KEEPER);
        const created = await toolsApi.create({
            inv_number: 'ИНВ-0100',
            name: 'Рубанок',
            category_id: '1',
            price: '1250,5',
            manufacturer: '',
        });
        expect(created).toMatchObject({
            inv_number: 'ИНВ-0100',
            category: 'Электроинструмент',
            price: 1250.5,
            manufacturer: null,
            status: 'in_stock',
        });
        await expect(toolsApi.create({ inv_number: 'инв-0100', name: 'Дубль', category_id: 1 })).rejects.toMatchObject({
            status: 409,
            message: 'Инструмент с таким инвентарным номером уже есть',
        });
        await expect(toolsApi.create({ inv_number: 'ИНВ-0101', name: 'Нет категории', category_id: 999 })).rejects.toMatchObject({
            status: 409,
        });
        const renamed = await toolsApi.update(created.id, { ...created, name: 'Рубанок 2' });
        expect(renamed.name).toBe('Рубанок 2');
    });

    it('issue -> extend -> return to repair, with the database messages on conflicts', async () => {
        as(KEEPER);
        const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        const issue = await issuesApi.issue({ tool_id: 2, employee_id: 1, due_at: due });
        expect(Array.isArray(issue)).toBe(false);
        expect(issue).toMatchObject({ tool_id: 2, employee_id: 1, issued_by: 'keeper@test', returned_at: null, overdue: 0 });
        await expect(issuesApi.issue({ tool_id: 2, employee_id: 1, due_at: due })).rejects.toMatchObject({
            status: 409,
            message: 'Инструмент нельзя выдать: он уже выдан',
        });

        const later = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
        expect((await issuesApi.extend(issue.id, { due_at: later })).due_at).toBe(later);
        await expect(issuesApi.extend(issue.id, { due_at: due })).rejects.toMatchObject({ status: 400 });

        const returned = await issuesApi.returnTool(issue.id, { condition_note: 'Заменить патрон', to_repair: true });
        expect(returned.returned_at).not.toBeNull();
        const [tool] = await toolsApi.list({ q: 'ИНВ-0002' });
        expect(tool).toMatchObject({ status: 'repair', note: 'Заменить патрон' });
        await expect(issuesApi.returnTool(issue.id, {})).rejects.toMatchObject({ status: 409, message: 'Инструмент уже возвращён' });
    });

    it('status rules: "issued" by hand is refused, write-off is for managers only', async () => {
        as(KEEPER);
        const [tool] = await toolsApi.list({ q: 'ИНВ-0006' });
        await expect(toolsApi.update(tool.id, { ...tool, status: 'issued' })).rejects.toMatchObject({ status: 409 });
        await expect(toolsApi.update(tool.id, { ...tool, status: 'written_off' })).rejects.toMatchObject({
            status: 403,
            message: 'Недостаточно прав',
        });
        as(BOSS);
        expect((await toolsApi.update(tool.id, { ...tool, status: 'written_off' })).status).toBe('written_off');
    });

    it('reports are for managers only and have the shapes the report page reads', async () => {
        as(KEEPER);
        await expect(statsApi.get()).rejects.toMatchObject({ status: 403, message: 'Недостаточно прав' });
        await expect(statsApi.usage()).rejects.toMatchObject({ status: 403 });

        as(BOSS);
        const stats = await statsApi.get();
        expect(stats.overdue).toBe(1);
        expect(Object.keys(stats.counts).sort()).toEqual(['in_stock', 'issued', 'repair', 'written_off']);
        expect(stats.counts.written_off).toBe(1);
        expect(typeof stats.total_cost).toBe('number');
        expect(stats.byCategory[0]).toEqual(
            expect.objectContaining({ name: expect.any(String), n: expect.any(Number), cost: expect.any(Number) }),
        );
        expect(stats.topEmployees[0]).toEqual(expect.objectContaining({ full_name: expect.any(String), n: expect.any(Number) }));

        const usage = await statsApi.usage();
        expect(usage.length).toBeGreaterThan(5);
        expect(usage[0]).toEqual(
            expect.objectContaining({ tool_id: expect.any(Number), issues_count: expect.any(Number), days_in_use: expect.any(Number) }),
        );
    });

    it('the overdue CSV contains the overdue issue', async () => {
        as(BOSS);
        const csv = await issuesApi.overdueCsv();
        expect(csv.startsWith(String.fromCharCode(0xfeff) + 'Инв. номер;')).toBe(true);
        expect(csv).toContain('ИНВ-0001;Дрель ударная Bosch GSB 13 RE;Иванов Пётр Сергеевич');
    });
    it('the health probe answers without signing in', async () => {
        const res = await fetch(`${URL}/rpc/health`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true });
    });

    it('the central log: a storekeeper appends, only a manager reads, anonymous visitors cannot write', async () => {
        as(KEEPER);
        await logsApi.send({
            level: 'error',
            message: 'integration test entry',
            context: { op: 'rpc/x', status: 500 },
            route: '/tools',
            release: 'abc1234',
        });
        await expect(logsApi.list()).rejects.toMatchObject({ status: 403, message: 'Недостаточно прав' });

        as(BOSS);
        const rows = await logsApi.list({ level: 'error' });
        expect(rows[0]).toMatchObject({
            level: 'error',
            message: 'integration test entry',
            route: '/tools',
            release: 'abc1234',
            context: { op: 'rpc/x', status: 500 },
        });
        expect(typeof rows[0].id).toBe('number');

        as(null);
        await expect(logsApi.send({ level: 'error', message: 'from anonymous' })).rejects.toMatchObject({ code: '42501' });
    });
});
