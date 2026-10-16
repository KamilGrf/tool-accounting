// GET /api/health: a Vercel function that reports whether the application can work.
// It checks what the app depends on: the database (a tiny SQL function), the Supabase sign-in service,
// and Google (sign-in with Google). Critical checks (database, sign-in service) decide the HTTP status:
// 200 when they pass, 503 when one fails. Google is "nice to have": its failure only marks the status "degraded".
// The answer contains no secrets and no details beyond names, timings and short error codes.

export const CHECK_TIMEOUT_MS = 5000;
// The endpoint is public, so every call would otherwise cost three outgoing requests: a flood of calls could be
// turned into a flood against Supabase and Google. Within this window a warm instance repeats the last answer.
export const CACHE_TTL_MS = 10_000;

let cached = null;

/** For tests: forget the remembered answer. */
export function resetHealthCache() {
    cached = null;
}

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

class ProbeError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

/** A short, safe label of what went wrong (messages coming from other services are never passed on). */
function errorCode(error) {
    if (error?.name === 'AbortError') return 'timeout';
    if (typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.code)) return error.code;
    return 'unreachable';
}

/** Run one probe with a timeout; never throws. `fn` receives the abort signal and must pass it to fetch. */
async function probe(name, critical, fn) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
        await fn(controller.signal);
        return { name, critical, ok: true, ms: Date.now() - started };
    } catch (error) {
        return { name, critical, ok: false, ms: Date.now() - started, error: errorCode(error) };
    } finally {
        clearTimeout(timer);
    }
}

const checks = [
    () =>
        probe('database', true, async (signal) => {
            const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/health`, {
                method: 'POST',
                headers: { apikey: supabaseKey(), 'Content-Type': 'application/json' },
                body: '{}',
                signal,
            });
            if (!res.ok) throw new ProbeError(`http_${res.status}`);
            const body = await res.json();
            if (body?.ok !== true) throw new ProbeError('bad_answer');
        }),

    () =>
        probe('auth', true, async (signal) => {
            const res = await fetch(`${supabaseUrl()}/auth/v1/health`, { headers: { apikey: supabaseKey() }, signal });
            if (!res.ok) throw new ProbeError(`http_${res.status}`);
        }),

    () =>
        probe('google', false, async (signal) => {
            const res = await fetch('https://accounts.google.com/.well-known/openid-configuration', { signal });
            if (!res.ok) throw new ProbeError(`http_${res.status}`);
        }),
];

/** Combine the results: down (a critical check failed) > degraded (only a non-critical one failed) > ok. */
export function summarize(results) {
    if (results.some((r) => r.critical && !r.ok)) return 'down';
    if (results.some((r) => !r.ok)) return 'degraded';
    return 'ok';
}

/** One JSON line per event: shows up in the Vercel logs and can be searched or exported. */
function log(level, message, fields = {}) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ status: 'error', error: 'method_not_allowed' });
    }
    if (!supabaseUrl() || !supabaseKey()) {
        log('error', 'health_misconfigured', { missing: 'supabase_url_or_key' });
        return res.status(503).json({ status: 'down', error: 'not_configured' });
    }

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return res.status(cached.status === 'down' ? 503 : 200).json(cached.body);
    }

    const results = await Promise.all(checks.map((run) => run()));
    const status = summarize(results);
    const body = {
        status,
        time: new Date().toISOString(),
        commit: (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7),
        checks: Object.fromEntries(results.map(({ name, ...rest }) => [name, rest])),
    };

    log(status === 'ok' ? 'info' : status === 'degraded' ? 'warn' : 'error', 'health', {
        status,
        failed: results.filter((r) => !r.ok).map((r) => `${r.name}:${r.error}`),
        ms: Math.max(...results.map((r) => r.ms)),
    });

    cached = { at: Date.now(), status, body };
    return res.status(status === 'down' ? 503 : 200).json(body);
}
