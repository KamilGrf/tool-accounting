'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, MANAGER } = require('./helpers');

test('ограничение по IP: после серии неудач с разными логинами вход блокируется даже с верным паролем', async () => {
    const t = await startApp({ loginIpFailureLimit: 3 });
    try {
        for (const login of ['a.one', 'b.two', 'c.three']) {
            assert.equal((await t.call('POST', '/api/auth/login', { login, password: 'bad-password-1' })).status, 401);
        }
        const blocked = await t.call('POST', '/api/auth/login', MANAGER);
        assert.equal(blocked.status, 429);
        assert.match(blocked.data.error, /Слишком много попыток/);
    } finally { await t.stop(); }
});
