'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, MANAGER } = require('./helpers');

let t; let cookie;
test.before(async () => { t = await startApp(); cookie = await t.login(MANAGER); });
test.after(() => t.stop());

const get = (url) => t.call('GET', url, undefined, { cookie });
const post = (url, body) => t.call('POST', url, body, { cookie });

test('список инструментов, фильтры и поиск (включая регистр кириллицы)', async () => {
    const all = await get('/api/tools');
    assert.equal(all.status, 200);
    assert.equal(all.data.length, 14);
    assert.ok((await get('/api/tools?q=bosch')).data.length >= 3);
    // The SQLite version could not do this: LIKE was case-insensitive for Latin only.
    const cyr = await get(`/api/tools?q=${encodeURIComponent('дрель')}`);
    assert.ok(cyr.data.some((x) => x.name.startsWith('Дрель')));
    assert.equal((await get('/api/tools?status=issued')).data.length, 2);
    assert.equal((await get('/api/tools?status=nonsense')).status, 400);
});

test('символы % и _ в поиске ищутся буквально', async () => {
    assert.equal((await get('/api/tools?q=%25')).data.length, 0);
    assert.equal((await get('/api/tools?q=_')).data.length, 0);
});

test('CRUD инструмента: валидация 400, дубликат 409 (без учёта регистра), 404', async () => {
    assert.equal((await post('/api/tools', { inv_number: '', name: 'X', category_id: 1 })).status, 400);
    assert.equal((await post('/api/tools', { inv_number: 'T-1', name: 'X', category_id: 1, price: -5 })).status, 400);
    assert.equal((await post('/api/tools', { inv_number: 'T-1', name: 'X', category_id: 999 })).status, 404);

    const created = await post('/api/tools', { inv_number: 'ИНВ-0100', name: 'Рубанок', category_id: 2, price: 990 });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'in_stock');
    assert.equal(created.data.price, 990);

    const dup = await post('/api/tools', { inv_number: 'инв-0100', name: 'Другой', category_id: 2 });
    assert.equal(dup.status, 409);
    assert.match(dup.data.error, /инвентарным номером/);

    const upd = await t.call('PUT', `/api/tools/${created.data.id}`, { ...created.data, name: 'Рубанок 2', price: 1100 }, { cookie });
    assert.equal(upd.data.name, 'Рубанок 2');
    assert.equal((await t.call('DELETE', `/api/tools/${created.data.id}`, undefined, { cookie })).status, 204);
    assert.equal((await get(`/api/tools/${created.data.id}`)).status, 404);
});

test('выдача и возврат: статусы, конфликты, пользователь в записи выдачи', async () => {
    const issue = await post('/api/issues', { tool_id: 2, employee_id: 4, due_at: '2099-01-01' });
    assert.equal(issue.status, 201);
    assert.equal(issue.data.issued_by, 'manager');
    assert.equal((await get('/api/tools/2')).data.status, 'issued');

    const again = await post('/api/issues', { tool_id: 2, employee_id: 5, due_at: '2099-01-01' });
    assert.equal(again.status, 409);
    assert.match(again.data.error, /уже выдан/);

    const ret = await post(`/api/issues/${issue.data.id}/return`, { condition_note: 'Исправен' });
    assert.equal(ret.status, 200);
    assert.ok(ret.data.returned_at);
    assert.equal((await get('/api/tools/2')).data.status, 'in_stock');
    assert.equal((await post(`/api/issues/${issue.data.id}/return`, {})).status, 409);
});

test('выдача: ремонт 409, срок раньше выдачи 400, нет сотрудника 404, нет срока 400', async () => {
    assert.equal((await post('/api/issues', { tool_id: 4, employee_id: 1, due_at: '2099-01-01' })).status, 409);
    assert.equal((await post('/api/issues', { tool_id: 6, employee_id: 1, issued_at: '2030-05-05', due_at: '2030-05-01' })).status, 400);
    assert.equal((await post('/api/issues', { tool_id: 6, employee_id: 999, due_at: '2099-01-01' })).status, 404);
    const noDue = await post('/api/issues', { tool_id: 6, employee_id: 1 });
    assert.equal(noDue.status, 400);
    assert.equal(noDue.data.error, 'Поле «Срок возврата» обязательно для заполнения');
    assert.equal((await post('/api/issues', { tool_id: 6, employee_id: 1, due_at: '2026-02-30' })).status, 400);
});

test('гонка: два одновременных запроса на выдачу одного инструмента — успех только у одного', async () => {
    const [a, b] = await Promise.all([
        post('/api/issues', { tool_id: 10, employee_id: 1, due_at: '2099-01-01' }),
        post('/api/issues', { tool_id: 10, employee_id: 2, due_at: '2099-01-01' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const open = (await get('/api/issues?tool=10&active=1')).data;
    assert.equal(open.length, 1);
});

test('возврат в ремонт сохраняет примечание', async () => {
    const issue = await post('/api/issues', { tool_id: 7, employee_id: 1, due_at: '2099-01-01' });
    await post(`/api/issues/${issue.data.id}/return`, { condition_note: 'Треснула рукоятка', to_repair: true });
    const tool = (await get('/api/tools/7')).data;
    assert.equal(tool.status, 'repair');
    assert.equal(tool.note, 'Треснула рукоятка');
});

test('продление срока: успех, 400 (не позже / нет даты), 404, 409 (уже возвращён)', async () => {
    const issue = await post('/api/issues', { tool_id: 8, employee_id: 2, due_at: '2099-01-01' });
    const ok = await post(`/api/issues/${issue.data.id}/extend`, { due_at: '2099-02-01' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.due_at, '2099-02-01');
    assert.equal((await post(`/api/issues/${issue.data.id}/extend`, { due_at: '2099-02-01' })).status, 400);
    assert.equal((await post(`/api/issues/${issue.data.id}/extend`, {})).status, 400);
    assert.equal((await post('/api/issues/9999/extend', { due_at: '2099-03-01' })).status, 404);
    await post(`/api/issues/${issue.data.id}/return`, {});
    assert.equal((await post(`/api/issues/${issue.data.id}/extend`, { due_at: '2099-03-01' })).status, 409);
});

test('просрочки, статистика и отчёт об использовании', async () => {
    const overdue = await get('/api/issues?overdue=1');
    assert.equal(overdue.data.length, 1);
    assert.equal(overdue.data[0].tool_id, 1);

    const stats = await get('/api/stats');
    assert.equal(stats.data.overdue, 1);
    assert.equal(typeof stats.data.total_cost, 'number');

    const usage = await get('/api/report/usage');
    assert.equal(usage.data.length, stats.data.total_tools);
    const drill = usage.data.find((r) => r.tool_id === 1);
    assert.equal(drill.issues_count, 1);
    assert.equal(drill.days_in_use, 10);
    assert.equal((await get('/api/report/usage?category=abc')).status, 400);
    assert.equal((await get('/api/report/usage?category=999')).status, 404);
});

test('CSV: BOM, заголовки, строка с просрочкой', async () => {
    const r = await get('/api/report/overdue.csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /overdue\.csv/);
    // fetch().text() strips a BOM, so check the raw bytes (EF BB BF) for Excel compatibility.
    const raw = Buffer.from(await (await fetch(`${t.base}/api/report/overdue.csv`, { headers: { Cookie: cookie } })).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    const lines = r.data.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Инв\. номер;Инструмент;Сотрудник/);
    assert.ok(Number(lines[1].split(';').pop()) > 0);
});

test('справочники: ограничения удаления и дубликаты', async () => {
    assert.equal((await t.call('DELETE', '/api/categories/1', undefined, { cookie })).status, 409);
    assert.equal((await t.call('DELETE', '/api/employees/1', undefined, { cookie })).status, 409);
    const cat = await post('/api/categories', { name: 'Тестовая' });
    assert.equal((await t.call('DELETE', `/api/categories/${cat.data.id}`, undefined, { cookie })).status, 204);
    assert.equal((await post('/api/categories', { name: 'Ручной инструмент' })).status, 409);
    assert.equal((await post('/api/employees', { full_name: '' })).status, 400);
});

test('статус «Выдан» вручную нельзя; списание руководителем работает', async () => {
    const tool = (await get('/api/tools/9')).data;
    assert.equal((await t.call('PUT', '/api/tools/9', { ...tool, status: 'issued' }, { cookie })).status, 409);
    const w = await t.call('PUT', '/api/tools/9', { ...tool, status: 'written_off' }, { cookie });
    assert.equal(w.data.status, 'written_off');
    assert.equal((await post('/api/issues', { tool_id: 9, employee_id: 1, due_at: '2099-01-01' })).status, 409);
});
