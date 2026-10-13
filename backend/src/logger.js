'use strict';
// Structured JSON logger (one line per event) that writes to stdout: `docker compose logs api`.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass|secret|token|cookie|authorization/i;

function redact(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? '[redacted]' : v;
    return out;
}

function createLogger(level = 'info', stream = process.stdout) {
    const min = LEVELS[level] ?? LEVELS.info;
    const write = (lvl, msg, fields = {}) => {
        if (LEVELS[lvl] < min) return;
        stream.write(`${JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...redact(fields) })}\n`);
    };
    return {
        debug: (m, f) => write('debug', m, f),
        info: (m, f) => write('info', m, f),
        warn: (m, f) => write('warn', m, f),
        error: (m, f) => write('error', m, f),
    };
}

module.exports = { createLogger };
