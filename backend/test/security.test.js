'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, MANAGER, ALLOWED_ORIGIN } = require('./helpers');
const { Database } = require('../src/db');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/logger');

let t; let manager; let keeper;
test.before(async () => {
    t = await startApp();
    manager = await t.login(MANAGER);
    keeper = await t.storekeeper();
});
test.after(() => t.stop());

test('роли: кладовщику запрещены отчёты, CSV, удаление инструмента и списание (403)', async () => {
    for (const url of ['/api/stats', '/api/report/usage', '/api/report/overdue.csv']) {
        const r = await t.call('GET', url, undefined, { cookie: keeper });
        assert.equal(r.status, 403, url);
        assert.equal(r.data.error, 'Недостаточно прав');
    }
    assert.equal((await t.call('DELETE', '/api/tools/13', undefined, { cookie: keeper })).status, 403);

    const tool = (await t.call('GET', '/api/tools/9', undefined, { cookie: keeper })).data;
    const writeOff = await t.call('PUT', '/api/tools/9', { ...tool, status: 'written_off' }, { cookie: keeper });
    assert.equal(writeOff.status, 403);
    assert.equal((await t.call('GET', '/api/tools/9', undefined, { cookie: keeper })).data.status, 'in_stock');
});

test('роли: кладовщик может работать с инструментами и выдачами, руководитель — со всем', async () => {
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: keeper })).status, 200);
    const issue = await t.call('POST', '/api/issues', { tool_id: 12, employee_id: 3, due_at: '2099-01-01' }, { cookie: keeper });
    assert.equal(issue.status, 201);
    assert.equal((await t.call('GET', '/api/stats', undefined, { cookie: manager })).status, 200);
});

test('CORS: разрешённый источник получает заголовки, чужой — 403; preflight отвечает 204', async () => {
    const ok = await t.call('GET', '/api/health', undefined, { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');

    const evil = await t.call('GET', '/api/health', undefined, { headers: { Origin: 'http://evil.test' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    const pre = await t.call('OPTIONS', '/api/tools', undefined, { headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
});

test('SQL-инъекция в параметрах поиска не работает, таблицы целы', async () => {
    const payloads = ["' OR '1'='1", "'; DROP TABLE tools; --", '" OR 1=1 --'];
    for (const p of payloads) {
        const r = await t.call('GET', `/api/tools?q=${encodeURIComponent(p)}`, undefined, { cookie: manager });
        assert.equal(r.status, 200);
        assert.equal(r.data.length, 0);
    }
    const all = await t.call('GET', '/api/tools', undefined, { cookie: manager });
    assert.ok(all.data.length >= 14);
    const login = await t.call('POST', '/api/auth/login', { login: "manager' --", password: 'x' });
    assert.equal(login.status, 401);
});

test('некорректный JSON 400, неизвестный маршрут 404, неверный метод 405, большое тело 413 с JSON', async () => {
    const badJson = await t.call('POST', '/api/categories', undefined, { cookie: manager, raw: '{oops', headers: { 'Content-Type': 'application/json' } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.data.error, 'Некорректный JSON в теле запроса');
    assert.equal((await t.call('GET', '/api/unknown', undefined, { cookie: manager })).status, 404);
    assert.equal((await t.call('PATCH', '/api/tools', {}, { cookie: manager })).status, 405);

    const big = await t.call('POST', '/api/categories', undefined, { cookie: manager, raw: JSON.stringify({ name: 'x'.repeat(1_100_000) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 413);
    assert.equal(big.data.error, 'Слишком большой запрос');
});

test('секреты не попадают в ответы и журнал', async () => {
    const secretPassword = 'Very-Secret-Pass-777';
    t.logs.lines.length = 0;
    await t.call('POST', '/api/auth/login', { login: 'manager', password: secretPassword });
    await t.call('POST', '/api/auth/register', { login: 'leak.check', password: secretPassword });
    const text = t.logs.text();
    assert.ok(text.includes('login failed'), 'failed login must be logged');
    assert.ok(!text.includes(secretPassword), 'password must never be logged');
    assert.ok(!text.includes(t.config.jwtSecret), 'JWT secret must never be logged');
    const me = await t.call('GET', '/api/auth/me', undefined, { cookie: manager });
    assert.deepEqual(Object.keys(me.data).sort(), ['id', 'login', 'role']);
});

test('ошибка БД даёт 500 с общим текстом, а подробности только в журнале', async () => {
    const broken = new Database(t.config.databaseUrl);
    await broken.close(); // every query on a closed pool now throws
    const lines = [];
    const logger = createLogger('debug', { write: (s) => lines.push(s) });
    const app = createApp({ config: t.config, db: broken, logger });
    const port = await app.listen(0, '127.0.0.1');
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'Внутренняя ошибка сервера' });
        const errorLine = lines.map((l) => JSON.parse(l)).find((l) => l.level === 'error' && l.msg === 'unhandled error');
        assert.ok(errorLine, 'server error must be logged');
        assert.ok(errorLine.reqId && errorLine.stack);
    } finally { await app.close(); }
});

test('каждый запрос журналируется: метод, путь, код, время, пользователь', async () => {
    t.logs.lines.length = 0;
    await t.call('GET', '/api/tools', undefined, { cookie: manager });
    const entry = t.logs.lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'request' && l.path === '/api/tools');
    assert.ok(entry);
    assert.equal(entry.status, 200);
    assert.equal(typeof entry.ms, 'number');
    assert.ok(entry.userId);
});

test('БД недоступна: быстрый ответ 503 с понятным текстом, причина в журнале', async () => {
    const unreachable = new Database('postgres://nobody:x@127.0.0.1:1/none'); // nothing listens on port 1
    const lines = [];
    const logger = createLogger('debug', { write: (s) => lines.push(s) });
    const app = createApp({ config: t.config, db: unreachable, logger });
    const port = await app.listen(0, '127.0.0.1');
    const started = Date.now();
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).error, 'Сервис временно недоступен. Попробуйте позже');
        assert.ok(Date.now() - started < 4000, 'must not hang');
        assert.ok(lines.map((l) => JSON.parse(l)).some((l) => l.msg === 'database unavailable' && l.code));
    } finally { await app.close(); await unreachable.close(); }
});
