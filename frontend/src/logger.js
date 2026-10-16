// Structured logging for the browser app.
// - Every entry is one JSON object: { ts, level, message, context, route, release }, written to the console.
// - Levels: debug < info < warn < error. The default threshold is "info" in production, "debug" in development.
// - Warnings and errors are also sent to the central store (table client_logs) while somebody is signed in.
// - Nothing personal leaves the browser: e-mail addresses are masked, fields that look like secrets are dropped,
//   long texts are cut, and only the path (never the query string) of the page is recorded.
// - Logging must never break the app: every failure inside it is swallowed.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const REMOTE_LEVELS = new Set(['warn', 'error']);
const REMOTE_BUDGET = 20; // entries sent to the central store per page view: a looping bug must not flood it
const MAX_TEXT = 300;

const RELEASE = import.meta.env.VITE_RELEASE || 'dev';
const SENSITIVE_KEY = /e-?mail|pass(word)?|token|secret|authorization|api-?key|cookie|phone/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

let threshold = import.meta.env.DEV ? 'debug' : 'info';
let remoteSink = null;
let remoteSent = 0;

export function setLogLevel(level) {
    if (LEVELS[level] !== undefined) threshold = level;
}

/** `sink(entry)` returns a promise; pass null to stop sending (signed out). */
export function setRemoteSink(sink) {
    remoteSink = sink;
    remoteSent = 0;
}

/** A copy of `value` that is safe to log (see the rules at the top of the file). */
export function scrub(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        const masked = value.replace(EMAIL, '[email]');
        return masked.length > MAX_TEXT ? `${masked.slice(0, MAX_TEXT)}…` : masked;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 3) return '[…]';
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, v] of Object.entries(value).slice(0, 20)) {
            out[key] = SENSITIVE_KEY.test(key) ? '[hidden]' : scrub(v, depth + 1);
        }
        return out;
    }
    return String(value);
}

/** Name, message and the first lines of the stack of an error, as plain data. */
export function describeError(error) {
    if (!error || typeof error !== 'object') return { message: String(error) };
    const stack = typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 5).join('\n') : undefined;
    return { name: error.name, message: error.message, ...(stack ? { stack } : {}) };
}

function sendRemote(entry) {
    if (!remoteSink || !REMOTE_LEVELS.has(entry.level) || remoteSent >= REMOTE_BUDGET) return;
    remoteSent += 1;
    try {
        Promise.resolve(remoteSink(entry)).catch(() => {});
    } catch {
        // never log a failed log
    }
}

export function log(level, message, context = {}) {
    try {
        if (LEVELS[level] === undefined || LEVELS[level] < LEVELS[threshold]) return;
        const entry = {
            ts: new Date().toISOString(),
            level,
            message: scrub(String(message)),
            context: scrub(context),
            route: typeof window === 'undefined' ? undefined : window.location.pathname,
            release: RELEASE,
        };
        console[level](JSON.stringify(entry));
        sendRemote(entry);
    } catch {
        // logging must never break the app
    }
}

export const logger = {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
};

/** Log errors that nobody caught. Returns a function that removes the listeners. */
export function installGlobalErrorLogging(target = window) {
    const onError = (event) =>
        logger.error('uncaught_error', { message: event.message, source: event.filename, line: event.lineno, column: event.colno });
    const onRejection = (event) => logger.error('unhandled_rejection', describeError(event.reason));
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}
