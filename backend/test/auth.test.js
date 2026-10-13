'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, MANAGER } = require('./helpers');
const { signToken } = require('../src/auth');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.stop());

test('регистрация создаёт кладовщика, выдаёт HttpOnly-cookie и не возвращает хеш пароля', async () => {
    const r = await t.call('POST', '/api/auth/register', { login: 'ivan.k', password: 'Strong-Pass-1' });
    assert.equal(r.status, 201);
    assert.equal(r.data.role, 'storekeeper');
    assert.equal(r.data.password_hash, undefined);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
});

test('регистрация: дубликат 409, короткий пароль и плохой логин 400', async () => {
    assert.equal((await t.call('POST', '/api/auth/register', { login: 'IVAN.K', password: 'Strong-Pass-1' })).status, 409);
    const weak = await t.call('POST', '/api/auth/register', { login: 'newuser', password: 'short' });
    assert.equal(weak.status, 400);
    assert.match(weak.data.error, /не короче 8/);
    assert.equal((await t.call('POST', '/api/auth/register', { login: 'a b', password: 'Strong-Pass-1' })).status, 400);
});

test('вход: верные данные дают сессию, /me возвращает пользователя', async () => {
    const cookie = await t.login(MANAGER);
    const me = await t.call('GET', '/api/auth/me', undefined, { cookie });
    assert.equal(me.status, 200);
    assert.deepEqual({ login: me.data.login, role: me.data.role }, { login: 'manager', role: 'manager' });
});

test('вход: неверный пароль и несуществующий логин дают одинаковый ответ 401', async () => {
    const wrong = await t.call('POST', '/api/auth/login', { login: 'manager', password: 'wrong-password' });
    const unknown = await t.call('POST', '/api/auth/login', { login: 'nobody', password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
    assert.equal(wrong.data.error, 'Неверный логин или пароль');
});

test('блокировка после 5 неудачных входов: 429 даже с верным паролем', async () => {
    await t.call('POST', '/api/auth/register', { login: 'locked.user', password: 'Right-Pass-1' });
    for (let i = 0; i < 5; i++) {
        assert.equal((await t.call('POST', '/api/auth/login', { login: 'locked.user', password: 'bad-password' })).status, 401);
    }
    const blocked = await t.call('POST', '/api/auth/login', { login: 'locked.user', password: 'Right-Pass-1' });
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /Слишком много попыток/);
});

test('защищённые маршруты: без cookie 401, подделанный, просроченный и alg=none токены отвергаются', async () => {
    assert.equal((await t.call('GET', '/api/tools')).status, 401);

    const secret = t.config.jwtSecret;
    const goodCookie = await t.login(MANAGER);
    const token = decodeURIComponent(goodCookie.split('=')[1]);

    const tampered = `${token.slice(0, -3)}abc`;
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: `session=${tampered}` })).status, 401);

    const expired = signToken({ sub: 1 }, secret, 60, Date.now() - 3600_000);
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: `session=${expired}` })).status, 401);

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 1, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: `session=${none}` })).status, 401);

    const wrongKey = signToken({ sub: 1 }, crypto.randomBytes(32).toString('hex'), 3600);
    assert.equal((await t.call('GET', '/api/tools', undefined, { cookie: `session=${wrongKey}` })).status, 401);
});

test('выход сбрасывает cookie', async () => {
    const cookie = await t.login(MANAGER);
    const r = await t.call('POST', '/api/auth/logout', {}, { cookie });
    assert.equal(r.status, 204);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('регистрацию можно отключить настройкой (403)', async () => {
    await t.stop(); // the helper recreates the shared test database, so stop the first instance first
    const closed = await startApp({ allowRegistration: false });
    try {
        const r = await closed.call('POST', '/api/auth/register', { login: 'someone', password: 'Strong-Pass-1' });
        assert.equal(r.status, 403);
    } finally { await closed.stop(); }
    t = { stop: async () => {} };
});
