'use strict';
// Integration-test helpers: a real PostgreSQL (docker compose up -d db) and a real HTTP server.
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../src/db');
const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { createApp } = require('../src/app');

const TEST_DB = 'tools_test';
// Test-only credentials for the throw-away test database (not real secrets).
const MANAGER = { login: 'manager', password: 'Manager-Test-1' };
const ALLOWED_ORIGIN = 'http://allowed.test';

/** Read ../../.env (docker compose settings) without printing or exporting anything. */
function dotenv() {
    const file = path.join(__dirname, '..', '..', '.env');
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function adminUrl() {
    if (process.env.TEST_ADMIN_DATABASE_URL) return process.env.TEST_ADMIN_DATABASE_URL;
    const e = dotenv();
    return `postgres://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@127.0.0.1:${e.DB_HOST_PORT || 5433}/${e.POSTGRES_DB}`;
}

function memoryStream() {
    const lines = [];
    return { lines, write: (s) => { lines.push(s); }, text: () => lines.join('') };
}

/** Fresh schema + demo data + a running app. Returns helpers; call `stop()` in test.after. */
async function startApp(overrides = {}) {
    const admin = new Database(adminUrl());
    const exists = await admin.get('SELECT 1 FROM pg_database WHERE datname = $1', TEST_DB);
    if (!exists) await admin.run(`CREATE DATABASE ${TEST_DB}`);
    await admin.close();

    const url = adminUrl().replace(/\/[^/]+$/, `/${TEST_DB}`);
    const db = new Database(url);
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');

    const logs = memoryStream();
    const logger = createLogger('debug', logs);
    await migrate(db, logger);
    await seed(db, logger, { MANAGER_LOGIN: MANAGER.login, MANAGER_PASSWORD: MANAGER.password, SEED_DEMO: 'true' });

    const config = { ...loadConfig({ DATABASE_URL: url, JWT_SECRET: 'j'.repeat(48), CORS_ORIGINS: ALLOWED_ORIGIN, ALLOW_REGISTRATION: 'true' }), ...overrides };
    const app = createApp({ config, db, logger });
    const base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;

    /** Make a request; `cookie` is a session cookie string from login(). */
    async function call(method, url, body, { cookie, headers = {}, raw } = {}) {
        const res = await fetch(base + url, {
            method,
            headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
            body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
        });
        const type = res.headers.get('content-type') || '';
        const data = res.status === 204 ? null : type.includes('json') ? await res.json().catch(() => null) : await res.text();
        return { status: res.status, data, headers: res.headers };
    }

    async function login(creds) {
        const r = await call('POST', '/api/auth/login', creds);
        if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.data)}`);
        return r.headers.get('set-cookie').split(';')[0];
    }

    /** Register a throw-away storekeeper and return its session cookie. */
    async function storekeeper(name = `keeper_${Math.random().toString(36).slice(2, 8)}`) {
        const r = await call('POST', '/api/auth/register', { login: name, password: 'Keeper-Pass-1' });
        if (r.status !== 201) throw new Error(`register failed: ${r.status}`);
        return r.headers.get('set-cookie').split(';')[0];
    }

    return { base, db, config, logs, call, login, storekeeper, MANAGER, ALLOWED_ORIGIN, stop: async () => { await app.close(); await db.close(); } };
}

module.exports = { startApp, MANAGER, ALLOWED_ORIGIN, memoryStream };
