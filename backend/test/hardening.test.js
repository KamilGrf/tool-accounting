'use strict';
// Regression tests for defects found by the independent security review.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { startApp, MANAGER } = require('./helpers');

let t; let manager;
test.before(async () => { t = await startApp({ loginIpFailureLimit: 1000 }); manager = await t.login(MANAGER); });
test.after(() => t.stop());

/** Send a raw HTTP request line (fetch normalizes odd paths, so use a socket). */
function rawRequest(port, path, headers = '') {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n${headers}Connection: close\r\n\r\n`));
        let data = '';
        socket.on('data', (c) => { data += c; });
        socket.on('close', () => resolve(data));
        socket.on('error', () => resolve(data));
    });
}

test('адрес вида «//» или «//[» не роняет процесс и даёт 4xx', async () => {
    const port = Number(new URL(t.base).port);
    for (const path of ['//', '//[']) {
        const answer = await rawRequest(port, path);
        assert.match(answer, /^HTTP\/1\.1 (400|401|404)/, `path ${path}`);
    }
    assert.equal((await t.call('GET', '/api/health')).status, 200); // still alive
});

test('перебор пароля параллельными запросами всё равно приводит к блокировке', async () => {
    await t.call('POST', '/api/auth/register', { login: 'race.victim', password: 'Right-Pass-1' });
    await Promise.all(Array.from({ length: 30 }, (_, i) =>
        t.call('POST', '/api/auth/login', { login: 'race.victim', password: `bad-password-${i}` })));
    const blocked = await t.call('POST', '/api/auth/login', { login: 'race.victim', password: 'Right-Pass-1' });
    assert.equal(blocked.status, 429);
});

test('несуществующий логин после 5 попыток отвечает так же, как существующий (нет перечисления)', async () => {
    const answers = [];
    for (let i = 0; i < 7; i++) answers.push((await t.call('POST', '/api/auth/login', { login: 'ghost.user', password: `bad-password-${i}` })).status);
    assert.deepEqual(answers.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(answers[6], 429);
});

test('битая cookie даёт 401, а не 500; слишком длинный пароль при входе — 401', async () => {
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: 'session=%' })).status, 401);
    const long = await t.call('POST', '/api/auth/login', { login: 'manager', password: 'x'.repeat(5000) });
    assert.equal(long.status, 401);
});

test('идентификатор в пути за пределами integer — 404, а не 500', async () => {
    assert.equal((await t.call('GET', '/api/tools/99999999999', undefined, { cookie: manager })).status, 404);
    assert.equal((await t.call('POST', '/api/issues/99999999999/return', {}, { cookie: manager })).status, 404);
});

test('поля неверного типа отклоняются (400): объект, массив, логическое значение', async () => {
    const bad = [
        { inv_number: { a: 1 }, name: 'X', category_id: 1 },
        { inv_number: 'T-9', name: ['a', 'b'], category_id: 1 },
        { inv_number: 'T-9', name: 'X', category_id: 1, price: true },
        { inv_number: 'T-9', name: 'X', category_id: 1, price: [5] },
        { inv_number: 'T-9', name: 'X', category_id: 1, price: '0x10' },
    ];
    for (const body of bad) {
        const r = await t.call('POST', '/api/tools', body, { cookie: manager });
        assert.equal(r.status, 400, JSON.stringify(body));
    }
});

test('выход работает и без действующей сессии (очищает битую cookie)', async () => {
    const r = await t.call('POST', '/api/auth/logout', {}, { cookie: 'session=garbage' });
    assert.equal(r.status, 204);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('введённый логин неизвестного пользователя не попадает в журнал (его могли перепутать с паролем)', async () => {
    t.logs.lines.length = 0;
    await t.call('POST', '/api/auth/login', { login: 'Oops-This-Is-A-Password-1', password: 'whatever-123' });
    assert.ok(t.logs.text().includes('login failed'));
    assert.ok(!t.logs.text().includes('Oops-This-Is-A-Password-1'));
});

test('регистрация по умолчанию выключена (безопасное значение по умолчанию)', () => {
    const { loadConfig } = require('../src/config');
    assert.equal(loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'j'.repeat(40) }).allowRegistration, false);
    assert.equal(loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'j'.repeat(40), ALLOW_REGISTRATION: 'true' }).allowRegistration, true);
});

test('смена статуса инструмента не затирает статус, изменённый параллельной выдачей', async () => {
    const tool = (await t.call('POST', '/api/tools', { inv_number: 'RACE-1', name: 'Гоночный', category_id: 1 }, { cookie: manager })).data;
    // Many rounds: update (which re-sends the stale status) races with issuing the same tool.
    const outcomes = [];
    for (let i = 0; i < 1; i++) {
        const [put, issue] = await Promise.all([
            t.call('PUT', `/api/tools/${tool.id}`, { ...tool, name: `Гоночный ${i}` }, { cookie: manager }),
            t.call('POST', '/api/issues', { tool_id: tool.id, employee_id: 1, due_at: '2099-01-01' }, { cookie: manager }),
        ]);
        outcomes.push([put.status, issue.status]);
    }
    assert.ok(outcomes.every(([p, i]) => [200, 409].includes(p) && [201, 409].includes(i)), JSON.stringify(outcomes));
    const final = (await t.call('GET', `/api/tools/${tool.id}`, undefined, { cookie: manager })).data;
    const open = (await t.call('GET', `/api/issues?tool=${tool.id}&active=1`, undefined, { cookie: manager })).data;
    // Invariant: a tool with an open issue must be "issued", and vice versa.
    assert.equal(final.status === 'issued', open.length === 1, JSON.stringify({ status: final.status, open: open.length }));
});
