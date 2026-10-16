import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { CACHE_TTL_MS, CHECK_TIMEOUT_MS, resetHealthCache, summarize } from './health.js';

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({}) });

/** A tiny stand-in for the Vercel response object. */
function makeRes() {
    const res = { headers: {}, statusCode: 200, body: undefined };
    res.setHeader = (k, v) => {
        res.headers[k] = v;
    };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    return res;
}

/** Route the three probes to canned answers (or functions) by URL. */
function stubFetch({ database = ok({ ok: true }), auth = ok(), google = ok() } = {}) {
    const pick = (answer, init) => (typeof answer === 'function' ? answer(init) : answer);
    const mock = vi.fn(async (url, init) => {
        if (String(url).includes('/rest/v1/rpc/health')) return pick(database, init);
        if (String(url).includes('/auth/v1/health')) return pick(auth, init);
        if (String(url).includes('accounts.google.com')) return pick(google, init);
        throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

beforeEach(() => {
    resetHealthCache();
    vi.stubEnv('SUPABASE_URL', 'https://p.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-key');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('summarize', () => {
    it('is down when a critical check fails, degraded when only a non-critical one fails, ok otherwise', () => {
        const c = (critical, okFlag) => ({ critical, ok: okFlag });
        expect(summarize([c(true, true), c(false, true)])).toBe('ok');
        expect(summarize([c(true, true), c(false, false)])).toBe('degraded');
        expect(summarize([c(true, false), c(false, true)])).toBe('down');
        expect(summarize([c(true, false), c(false, false)])).toBe('down');
    });
});

describe('GET /api/health', () => {
    it('answers 200 "ok" with the three checks, the commit and no caching', async () => {
        stubFetch();
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(200);
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(res.body.status).toBe('ok');
        expect(res.body.commit).toBe('abcdef1');
        expect(Object.keys(res.body.checks)).toEqual(['database', 'auth', 'google']);
        expect(res.body.checks.database).toMatchObject({ ok: true, critical: true });
        expect(res.body.checks.google.critical).toBe(false);
    });

    it('calls the database check with the public key and a SQL function, not with any table', async () => {
        const mock = stubFetch();
        await handler({ method: 'GET' }, makeRes());
        const [url, init] = mock.mock.calls.find(([u]) => String(u).includes('/rpc/health'));
        expect(url).toBe('https://p.supabase.co/rest/v1/rpc/health');
        expect(init.method).toBe('POST');
        expect(init.headers.apikey).toBe('public-key');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('answers 503 "down" when the database does not answer properly', async () => {
        stubFetch({ database: bad(404) });
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.status).toBe('down');
        expect(res.body.checks.database).toMatchObject({ ok: false, error: 'http_404' });
        expect(res.body.checks.auth.ok).toBe(true);
    });

    it('answers 503 when the database replies with something else than ok', async () => {
        stubFetch({ database: ok({ ok: false }) });
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.checks.database.error).toBe('bad_answer');
    });

    it('answers 503 when the sign-in service is down', async () => {
        stubFetch({ auth: bad(502) });
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.checks.auth.error).toBe('http_502');
    });

    it('answers 200 "degraded" when only Google is unreachable', async () => {
        stubFetch({
            google: () => {
                throw new TypeError('fetch failed: secret internal text');
            },
        });
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.google).toMatchObject({ ok: false, error: 'unreachable' });
        expect(JSON.stringify(res.body)).not.toContain('secret internal text'); // other services' messages are never passed on
    });

    it('gives up on a hanging check after the timeout instead of hanging itself', async () => {
        vi.useFakeTimers();
        stubFetch({
            database: ({ signal }) =>
                new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                }),
        });
        const res = makeRes();
        const pending = handler({ method: 'GET' }, res);
        await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 10);
        await pending;
        expect(res.statusCode).toBe(503);
        expect(res.body.checks.database.error).toBe('timeout');
        expect(res.body.checks.auth.ok).toBe(true);
    });

    it('reports a misconfiguration without calling anything', async () => {
        vi.stubEnv('SUPABASE_URL', '');
        vi.stubEnv('VITE_SUPABASE_URL', '');
        const mock = stubFetch();
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ status: 'down', error: 'not_configured' });
        expect(mock).not.toHaveBeenCalled();
    });

    it('falls back to the VITE_ variables set for the build', async () => {
        vi.stubEnv('SUPABASE_URL', '');
        vi.stubEnv('SUPABASE_ANON_KEY', '');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://vite.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'vite-key');
        const mock = stubFetch();
        const res = makeRes();
        await handler({ method: 'GET' }, res);
        expect(res.statusCode).toBe(200);
        expect(mock.mock.calls[0][0]).toContain('https://vite.supabase.co');
    });

    it('accepts only GET and HEAD', async () => {
        const mock = stubFetch();
        const res = makeRes();
        await handler({ method: 'POST' }, res);
        expect(res.statusCode).toBe(405);
        expect(res.headers.Allow).toBe('GET, HEAD');
        expect(mock).not.toHaveBeenCalled();
    });

    it('writes one JSON log line per request with the failed checks and no secrets', async () => {
        stubFetch({ database: bad(500) });
        await handler({ method: 'GET' }, makeRes());
        const line = JSON.parse(console.error.mock.calls[0][0]);
        expect(line).toMatchObject({ level: 'error', message: 'health', status: 'down', failed: ['database:http_500'] });
        expect(console.error.mock.calls[0][0]).not.toContain('public-key');
    });
});

describe('caching of the answer', () => {
    it('repeats the last answer within the window without calling the services again', async () => {
        const mock = stubFetch();
        const first = makeRes();
        await handler({ method: 'GET' }, first);
        const second = makeRes();
        await handler({ method: 'GET' }, second);
        expect(mock).toHaveBeenCalledTimes(3);
        expect(second.body).toEqual(first.body);
        expect(second.headers['Cache-Control']).toBe('no-store');
    });

    it('asks again after the window, and a failure is not remembered longer than that', async () => {
        vi.useFakeTimers();
        let databaseUp = false;
        const mock = stubFetch({ database: () => (databaseUp ? ok({ ok: true }) : bad(500)) });
        const down = makeRes();
        await handler({ method: 'GET' }, down);
        expect(down.statusCode).toBe(503);
        const still = makeRes();
        await handler({ method: 'GET' }, still);
        expect(still.statusCode).toBe(503);
        expect(mock).toHaveBeenCalledTimes(3);

        databaseUp = true;
        vi.advanceTimersByTime(CACHE_TTL_MS + 1);
        const up = makeRes();
        await handler({ method: 'GET' }, up);
        expect(up.statusCode).toBe(200);
        expect(mock).toHaveBeenCalledTimes(6);
    });

    it('does not cache a misconfiguration or a refused method', async () => {
        const mock = stubFetch();
        const post = makeRes();
        await handler({ method: 'POST' }, post);
        expect(post.statusCode).toBe(405);
        expect(mock).not.toHaveBeenCalled();
    });
});
