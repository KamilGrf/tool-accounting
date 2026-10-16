// Data access on Supabase. One function per use case, same names and result shapes the UI already used
// (they used to call a REST API). Lists and business operations are database functions (RPC),
// plain row writes go to the tables; row security is enforced by the database (supabase/migrations).
import { ApiError, NetworkError, run, toAuthError } from './client.js';
import { fetchWithTimeout, projectConfig, supabase } from './supabase.js';
import { buildOverdueCsv } from '../utils/csv.js';
import { toolRow } from '../utils/toolPayload.js';

export { isConfigured } from './supabase.js';

const flag = (v) => v === true || String(v) === '1' || String(v) === 'true';
const idOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Role and e-mail of a signed-in user (the role lives in public.profiles, never in the token). */
async function loadProfile(user) {
    const row = await run(supabase.from('profiles').select('id, email, role').eq('id', user.id).maybeSingle());
    if (!row) throw new ApiError(403, 'Профиль пользователя не найден');
    return { id: row.id, login: row.email, role: row.role };
}

export const authApi = {
    /** Current user, or ApiError 401 when nobody is signed in. */
    async me() {
        let session;
        try {
            ({
                data: { session },
            } = await supabase.auth.getSession());
        } catch {
            throw new NetworkError();
        }
        if (!session) throw new ApiError(401, 'Требуется вход');
        return loadProfile(session.user);
    },

    async login({ email, password }) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password }).catch((e) => ({ error: e }));
        if (error) throw toAuthError(error);
        return loadProfile(data.user);
    },

    /** Returns the new user, or { needsConfirmation: true } when the project requires e-mail confirmation. */
    async register({ email, password }) {
        const { data, error } = await supabase.auth.signUp({ email, password }).catch((e) => ({ error: e }));
        if (error) throw toAuthError(error);
        if (!data.session) return { needsConfirmation: true };
        return loadProfile(data.user);
    },

    /** Sends the browser to Google; it comes back to this site with a session (PKCE) or with an error in the URL. */
    async loginWithGoogle() {
        const { error } = await supabase.auth
            .signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
            .catch((e) => ({ error: e }));
        if (error) throw toAuthError(error);
    },

    /** Which OAuth providers are switched on in the project (a public endpoint); any failure means "none". */
    async oauthProviders() {
        try {
            const res = await fetchWithTimeout(`${projectConfig.url}/auth/v1/settings`, { headers: { apikey: projectConfig.anonKey } });
            if (!res.ok) return { google: false };
            const settings = await res.json();
            return { google: Boolean(settings?.external?.google) };
        } catch {
            return { google: false };
        }
    },

    async logout() {
        await supabase.auth.signOut();
    },

    /** Call `callback` when the session ends by itself (refresh failed, signed out in another tab). */
    onSessionEnd(callback) {
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') callback();
        });
        return () => data.subscription.unsubscribe();
    },
};

const getTool = (id) => run(supabase.from('v_tools').select('*').eq('id', id).single());

export const toolsApi = {
    list: ({ q, category, status } = {}) =>
        run(
            supabase.rpc('list_tools', {
                p_q: q || null,
                p_category: idOrNull(category),
                p_status: status || null,
            }),
        ),

    async create(body) {
        const row = toolRow(body); // validate first: a bad form never reaches the database
        const created = await run(supabase.from('tools').insert(row).select('id').single());
        return getTool(created.id);
    },

    async update(id, body) {
        const row = { ...toolRow(body), ...(body.status ? { status: body.status } : {}) };
        const updated = await run(supabase.from('tools').update(row).eq('id', id).select('id'));
        if (!updated.length) throw new ApiError(404, 'Инструмент не найден');
        return getTool(id);
    },
};

export const issuesApi = {
    list: ({ active, overdue, employee, tool } = {}) =>
        run(
            supabase.rpc('list_issues', {
                p_active: flag(active),
                p_overdue: flag(overdue),
                p_employee: idOrNull(employee),
                p_tool: idOrNull(tool),
            }),
        ),

    issue: ({ tool_id: toolId, employee_id: employeeId, due_at: dueAt, issued_at: issuedAt }) =>
        run(
            supabase.rpc('issue_tool', {
                p_tool_id: idOrNull(toolId),
                p_employee_id: idOrNull(employeeId),
                p_due_at: dueAt || null,
                p_issued_at: issuedAt || null,
            }),
        ),

    returnTool: (id, { condition_note: note, to_repair: toRepair, returned_at: returnedAt } = {}) =>
        run(
            supabase.rpc('return_tool', {
                p_issue_id: id,
                p_condition_note: note || null,
                p_to_repair: flag(toRepair),
                p_returned_at: returnedAt || null,
            }),
        ),

    extend: (id, { due_at: dueAt } = {}) => run(supabase.rpc('extend_issue', { p_issue_id: id, p_due_at: dueAt || null })),

    /** CSV text of the overdue returns (see utils/csv.js). */
    async overdueCsv() {
        return buildOverdueCsv(await issuesApi.list({ overdue: 1 }));
    },
};

export const employeesApi = { list: ({ q } = {}) => run(supabase.rpc('list_employees', { p_q: q || null })) };
export const categoriesApi = { list: () => run(supabase.from('v_categories').select('*').order('name')) };

export const statsApi = {
    get: () => run(supabase.rpc('report_stats')),
    usage: () => run(supabase.rpc('report_usage')),
};
