import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './client.js';
import { authApi, categoriesApi, employeesApi, issuesApi, statsApi, toolsApi, usersApi } from './index.js';

// A fake Supabase client: rpc() answers from `state.rpc`, from(table) returns a chain that records the
// calls (insert/update/select/eq...) and answers from `state.tables[table]`; auth answers from `state.auth`.
const h = vi.hoisted(() => {
    const state = { rpc: {}, tables: {}, auth: {}, ops: [] };
    const chain = (table) => {
        const rec = { table, ops: [] };
        state.ops.push(rec);
        const proxy = new Proxy(
            {},
            {
                get(_, prop) {
                    if (prop === 'then') {
                        return (resolve, reject) =>
                            Promise.resolve(state.tables[table]?.(rec) ?? { data: null, error: null }).then(resolve, reject);
                    }
                    return (...args) => {
                        rec.ops.push([prop, ...args]);
                        return proxy;
                    };
                },
            },
        );
        return proxy;
    };
    const client = {
        rpc: vi.fn((name, args) => Promise.resolve(state.rpc[name]?.(args) ?? { data: null, error: null })),
        from: vi.fn(chain),
        auth: {
            getSession: vi.fn(async () => ({ data: { session: state.auth.session ?? null } })),
            signInWithPassword: vi.fn(async () => state.auth.signIn),
            signUp: vi.fn(async () => state.auth.signUp),
            signInWithOAuth: vi.fn(async () => state.auth.oauth ?? { data: {}, error: null }),
            signOut: vi.fn(async () => ({ error: null })),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
    };
    return { state, client };
});
vi.mock('./supabase.js', () => ({
    supabase: h.client,
    isConfigured: true,
    projectConfig: { url: 'https://p.supabase.co', anonKey: 'public-key' },
    fetchWithTimeout: (...args) => fetch(...args),
}));

const ok = (data) => ({ data, error: null });
const fail = (code, message) => ({ data: null, error: { code, message } });
const opsOf = (table) => h.state.ops.filter((r) => r.table === table).flatMap((r) => r.ops);
const toolRowForm = {
    inv_number: ' ИНВ-0100 ',
    name: 'Рубанок',
    category_id: '2',
    manufacturer: '',
    price: '99,5',
    location: ' ',
    purchase_date: '',
};

beforeEach(() => {
    Object.assign(h.state, { rpc: {}, tables: {}, auth: {}, ops: [] });
    vi.clearAllMocks();
});

describe('tools', () => {
    it('list sends empty filters as null and a numeric category', async () => {
        h.state.rpc.list_tools = () => ok([{ id: 1 }]);
        expect(await toolsApi.list({ q: '', category: '2', status: '' })).toEqual([{ id: 1 }]);
        expect(h.client.rpc).toHaveBeenCalledWith('list_tools', { p_q: null, p_category: 2, p_status: null });
        await toolsApi.list({ q: 'bosch', status: 'repair' });
        expect(h.client.rpc).toHaveBeenLastCalledWith('list_tools', { p_q: 'bosch', p_category: null, p_status: 'repair' });
    });

    it('turns a database permission error into ApiError 403', async () => {
        h.state.rpc.list_tools = () => fail('42501', 'permission denied for function list_tools');
        await expect(toolsApi.list()).rejects.toMatchObject({ status: 403, message: 'Недостаточно прав' });
    });

    it('turns a failed request into NetworkError', async () => {
        h.state.rpc.list_tools = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
        await expect(toolsApi.list()).rejects.toBeInstanceOf(NetworkError);
    });

    it('create normalizes the form values and returns the stored tool', async () => {
        h.state.tables.tools = () => ok({ id: 7 });
        h.state.tables.v_tools = () => ok({ id: 7, name: 'Рубанок' });
        expect(await toolsApi.create({ ...toolRowForm, id: 5, category: 'не колонка' })).toEqual({ id: 7, name: 'Рубанок' });
        const insert = opsOf('tools').find(([op]) => op === 'insert');
        expect(insert[1]).toEqual({
            inv_number: 'ИНВ-0100',
            name: 'Рубанок',
            category_id: 2,
            manufacturer: null,
            purchase_date: null,
            price: 99.5,
            location: null,
            note: null,
        });
    });

    it('create rejects an invalid price before any request is made', async () => {
        await expect(toolsApi.create({ ...toolRowForm, price: 'abc' })).rejects.toMatchObject({
            status: 400,
            message: 'Цена должна быть неотрицательным числом',
        });
        await expect(toolsApi.create({ ...toolRowForm, name: '  ' })).rejects.toMatchObject({
            status: 400,
            message: 'Поле «Наименование» обязательно для заполнения',
        });
        expect(h.client.from).not.toHaveBeenCalled();
    });

    it('create explains a duplicate inventory number', async () => {
        h.state.tables.tools = () => fail('23505', 'duplicate key value violates unique constraint "ux_tools_inv_number"');
        await expect(toolsApi.create(toolRowForm)).rejects.toMatchObject({
            status: 409,
            message: 'Инструмент с таким инвентарным номером уже есть',
        });
    });

    it('update sends the status only when it is given and reports a missing tool', async () => {
        h.state.tables.tools = () => ok([{ id: 3 }]);
        h.state.tables.v_tools = () => ok({ id: 3 });
        await toolsApi.update(3, toolRowForm);
        expect(opsOf('tools').find(([op]) => op === 'update')[1]).not.toHaveProperty('status');
        await toolsApi.update(3, { ...toolRowForm, status: 'written_off' });
        expect(opsOf('tools').filter(([op]) => op === 'update')[1][1]).toHaveProperty('status', 'written_off');

        h.state.tables.tools = () => ok([]);
        await expect(toolsApi.update(3, toolRowForm)).rejects.toMatchObject({ status: 404, message: 'Инструмент не найден' });
    });

    it('update shows the database message when a storekeeper tries to write a tool off', async () => {
        h.state.tables.tools = () => fail('P0403', 'Недостаточно прав');
        await expect(toolsApi.update(3, { ...toolRowForm, status: 'written_off' })).rejects.toMatchObject({
            status: 403,
            message: 'Недостаточно прав',
        });
    });
});

describe('issues', () => {
    it('list maps the old query flags to function parameters', async () => {
        h.state.rpc.list_issues = () => ok([]);
        await issuesApi.list({ active: 1 });
        expect(h.client.rpc).toHaveBeenLastCalledWith('list_issues', { p_active: true, p_overdue: false, p_employee: null, p_tool: null });
        await issuesApi.list({ overdue: '1', tool: 5 });
        expect(h.client.rpc).toHaveBeenLastCalledWith('list_issues', { p_active: false, p_overdue: true, p_employee: null, p_tool: 5 });
    });

    it('issue, return and extend call the matching functions', async () => {
        h.state.rpc.issue_tool = () => ok({ id: 11 });
        h.state.rpc.return_tool = () => ok({ id: 11 });
        h.state.rpc.extend_issue = () => ok({ id: 11 });
        await issuesApi.issue({ tool_id: 2, employee_id: 1, due_at: '2026-12-01' });
        expect(h.client.rpc).toHaveBeenLastCalledWith('issue_tool', {
            p_tool_id: 2,
            p_employee_id: 1,
            p_due_at: '2026-12-01',
            p_issued_at: null,
        });
        await issuesApi.returnTool(11, { condition_note: 'Царапина', to_repair: true });
        expect(h.client.rpc).toHaveBeenLastCalledWith('return_tool', {
            p_issue_id: 11,
            p_condition_note: 'Царапина',
            p_to_repair: true,
            p_returned_at: null,
        });
        await issuesApi.extend(11, { due_at: '2026-12-10' });
        expect(h.client.rpc).toHaveBeenLastCalledWith('extend_issue', { p_issue_id: 11, p_due_at: '2026-12-10' });
    });

    it('shows the conflict message of the database as is', async () => {
        h.state.rpc.issue_tool = () => fail('P0409', 'Инструмент нельзя выдать: он уже выдан');
        const err = await issuesApi.issue({ tool_id: 2, employee_id: 1, due_at: '2026-12-01' }).catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err).toMatchObject({ status: 409, message: 'Инструмент нельзя выдать: он уже выдан' });
    });

    it('overdueCsv builds the file from the overdue issues', async () => {
        h.state.rpc.list_issues = () =>
            ok([
                {
                    inv_number: 'ИНВ-0001',
                    tool_name: 'Дрель',
                    employee_name: 'Иванов',
                    department: 'Цех',
                    issued_at: '2020-01-01',
                    due_at: '2020-01-05',
                },
            ]);
        const csv = await issuesApi.overdueCsv();
        expect(h.client.rpc).toHaveBeenCalledWith('list_issues', expect.objectContaining({ p_overdue: true }));
        expect(csv.startsWith(String.fromCharCode(0xfeff) + 'Инв. номер;')).toBe(true);
        expect(csv).toContain('ИНВ-0001;Дрель;Иванов;Цех;2020-01-01;2020-01-05;');
    });
});

describe('lists and reports', () => {
    it('employees and categories', async () => {
        h.state.rpc.list_employees = () => ok([{ id: 1 }]);
        h.state.tables.v_categories = () => ok([{ id: 1, name: 'А' }]);
        expect(await employeesApi.list({ q: '' })).toEqual([{ id: 1 }]);
        expect(h.client.rpc).toHaveBeenCalledWith('list_employees', { p_q: null });
        expect(await categoriesApi.list()).toEqual([{ id: 1, name: 'А' }]);
    });

    it('reports pass the data through and refuse non-managers with the database message', async () => {
        h.state.rpc.report_stats = () => ok({ overdue: 1 });
        h.state.rpc.report_usage = () => fail('P0403', 'Недостаточно прав');
        expect(await statsApi.get()).toEqual({ overdue: 1 });
        await expect(statsApi.usage()).rejects.toMatchObject({ status: 403 });
    });
});

describe('authentication', () => {
    const profile = { id: 'u1', email: 'ivan@test.ru', role: 'manager' };

    it('me: nobody signed in -> 401', async () => {
        await expect(authApi.me()).rejects.toMatchObject({ status: 401 });
    });

    it('me: signed in -> e-mail and role from the profile', async () => {
        h.state.auth.session = { user: { id: 'u1' } };
        h.state.tables.profiles = () => ok(profile);
        expect(await authApi.me()).toEqual({ id: 'u1', login: 'ivan@test.ru', role: 'manager' });
    });

    it('me: a user without a profile gets 403', async () => {
        h.state.auth.session = { user: { id: 'u1' } };
        h.state.tables.profiles = () => ok(null);
        await expect(authApi.me()).rejects.toMatchObject({ status: 403 });
    });

    it('login: wrong credentials -> 401 with a Russian message', async () => {
        h.state.auth.signIn = { data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } };
        await expect(authApi.login({ email: 'a@b.ru', password: 'x' })).rejects.toMatchObject({
            status: 401,
            message: 'Неверный email или пароль',
        });
    });

    it('login: success loads the profile', async () => {
        h.state.auth.signIn = { data: { user: { id: 'u1' } }, error: null };
        h.state.tables.profiles = () => ok(profile);
        expect(await authApi.login({ email: 'ivan@test.ru', password: 'secret-pass' })).toMatchObject({
            login: 'ivan@test.ru',
            role: 'manager',
        });
        expect(h.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ivan@test.ru', password: 'secret-pass' });
    });

    it('register: e-mail confirmation required -> no session yet', async () => {
        h.state.auth.signUp = { data: { user: { id: 'u2' }, session: null }, error: null };
        expect(await authApi.register({ email: 'new@test.ru', password: 'long-enough-1' })).toEqual({ needsConfirmation: true });
    });

    it('register: an existing e-mail -> 409', async () => {
        h.state.auth.signUp = { data: {}, error: { code: 'user_already_exists', status: 422, message: 'User already registered' } };
        await expect(authApi.register({ email: 'a@b.ru', password: 'long-enough-1' })).rejects.toMatchObject({ status: 409 });
    });

    it('logout signs out of Supabase', async () => {
        await authApi.logout();
        expect(h.client.auth.signOut).toHaveBeenCalledOnce();
    });
});

describe('Google sign-in', () => {
    it('loginWithGoogle starts the OAuth flow and returns to this site', async () => {
        await authApi.loginWithGoogle();
        expect(h.client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } });
    });

    it('loginWithGoogle reports a failure to start', async () => {
        h.state.auth.oauth = { data: null, error: { code: 'validation_failed', status: 400, message: 'Unsupported provider' } };
        await expect(authApi.loginWithGoogle()).rejects.toMatchObject({ status: 400 });
    });

    describe('oauthProviders', () => {
        afterEach(() => vi.unstubAllGlobals());

        it('reads which providers the project has switched on from the public settings', async () => {
            const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ external: { google: true, github: false } }) }));
            vi.stubGlobal('fetch', fetchMock);
            expect(await authApi.oauthProviders()).toEqual({ google: true });
            expect(fetchMock).toHaveBeenCalledWith('https://p.supabase.co/auth/v1/settings', { headers: { apikey: 'public-key' } });
        });

        it('reports Google as off when the provider is disabled', async () => {
            vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ external: { google: false } }) }));
            expect(await authApi.oauthProviders()).toEqual({ google: false });
        });

        it('hides the option when the settings cannot be read', async () => {
            vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
            expect(await authApi.oauthProviders()).toEqual({ google: false });
            vi.stubGlobal('fetch', async () => {
                throw new TypeError('Failed to fetch');
            });
            expect(await authApi.oauthProviders()).toEqual({ google: false });
        });
    });
});

describe('users (approval of accounts)', () => {
    it('list calls list_users and returns the accounts', async () => {
        h.state.rpc.list_users = () => ok([{ id: 'p1', email: 'new@test.ru', role: 'pending' }]);
        expect(await usersApi.list()).toEqual([{ id: 'p1', email: 'new@test.ru', role: 'pending' }]);
        expect(h.client.rpc).toHaveBeenCalledWith('list_users');
    });

    it('setRole sends the id and the role', async () => {
        h.state.rpc.set_user_role = () => ok(null);
        await usersApi.setRole('p1', 'storekeeper');
        expect(h.client.rpc).toHaveBeenLastCalledWith('set_user_role', { p_user_id: 'p1', p_role: 'storekeeper' });
    });

    it('the database refusals reach the user as they are', async () => {
        h.state.rpc.set_user_role = () => fail('P0409', 'Нельзя изменить собственную роль');
        await expect(usersApi.setRole('me', 'manager')).rejects.toMatchObject({ status: 409, message: 'Нельзя изменить собственную роль' });
        h.state.rpc.list_users = () => fail('P0403', 'Недостаточно прав');
        await expect(usersApi.list()).rejects.toMatchObject({ status: 403 });
    });
});
