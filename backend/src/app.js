'use strict';
// HTTP layer: routing, authentication / role checks, CORS, error handling, request logging.
const http = require('node:http');
const crypto = require('node:crypto');
const { HttpError, fromDbError, isDbUnavailable } = require('./errors');
const { signToken, verifyToken, readCookie, sessionCookie, clearCookie } = require('./auth');
const { CategoryRepository, ToolRepository, EmployeeRepository, IssueRepository } = require('./repositories');
const { IssueService } = require('./services');
const { UserService } = require('./userService');

const MANAGER = ['manager'];

/** Handler result with an explicit status / headers (default: 201 for POST, 200 otherwise). */
class Reply {
    constructor(data, { status, headers = {}, type } = {}) { Object.assign(this, { data, status, headers, type }); }
}

function createApp({ config, db, logger }) {
    const categories = new CategoryRepository(db);
    const tools = new ToolRepository(db);
    const employees = new EmployeeRepository(db);
    const issues = new IssueRepository(db);
    const service = new IssueService(db);
    const users = new UserService(db, config, logger);

    const cookieOpts = { secure: config.cookieSecure, maxAge: config.sessionTtlSeconds };
    const startSession = (user, status) => new Reply(
        { id: user.id, login: user.login, role: user.role },
        { status, headers: { 'Set-Cookie': sessionCookie(signToken({ sub: user.id }, config.jwtSecret, config.sessionTtlSeconds), cookieOpts) } });

    // ---- route table: [method, pattern, access, handler]; access = 'public' | 'any' | [roles] ----
    const routes = [];
    const add = (method, pattern, access, fn) => {
        const keys = [];
        const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; })}$`);
        routes.push({ method, re, keys, access, fn });
    };

    add('GET', '/api/health', 'public', async () => {
        await db.get('SELECT 1');
        return { status: 'ok' };
    });
    add('POST', '/api/auth/register', 'public', async (c) => startSession(await users.register(c.body), 201));
    add('POST', '/api/auth/login', 'public', async (c) => startSession(await users.login(c.body, c.ip), 200));
    add('POST', '/api/auth/logout', 'public', () => new Reply(undefined, { status: 204, headers: { 'Set-Cookie': clearCookie(cookieOpts) } }));
    add('GET', '/api/auth/me', 'any', (c) => c.user);

    add('GET', '/api/categories', 'any', () => categories.list());
    add('POST', '/api/categories', 'any', (c) => categories.create(c.body));
    add('PUT', '/api/categories/:id', 'any', (c) => categories.update(c.p.id, c.body));
    add('DELETE', '/api/categories/:id', 'any', (c) => categories.remove(c.p.id));

    add('GET', '/api/tools', 'any', (c) => tools.list(c.query));
    add('GET', '/api/tools/:id', 'any', (c) => tools.get(c.p.id));
    add('POST', '/api/tools', 'any', (c) => tools.create(c.body));
    add('PUT', '/api/tools/:id', 'any', (c) => db.transaction((tx) => new ToolRepository(tx).update(c.p.id, c.body, c.user)));
    add('DELETE', '/api/tools/:id', MANAGER, (c) => tools.remove(c.p.id));

    add('GET', '/api/employees', 'any', (c) => employees.list(c.query));
    add('POST', '/api/employees', 'any', (c) => employees.create(c.body));
    add('PUT', '/api/employees/:id', 'any', (c) => employees.update(c.p.id, c.body));
    add('DELETE', '/api/employees/:id', 'any', (c) => employees.remove(c.p.id));

    add('GET', '/api/issues', 'any', (c) => issues.list(c.query));
    add('POST', '/api/issues', 'any', (c) => service.issueTool(c.body, c.user));
    add('POST', '/api/issues/:id/return', 'any', async (c) => new Reply(await service.returnTool(c.p.id, c.body, c.user), { status: 200 }));
    add('POST', '/api/issues/:id/extend', 'any', async (c) => new Reply(await service.extendIssue(c.p.id, c.body), { status: 200 }));

    add('GET', '/api/stats', MANAGER, () => service.stats());
    add('GET', '/api/report/usage', MANAGER, (c) => service.usageReport(c.query));
    add('GET', '/api/report/overdue.csv', MANAGER, async () => new Reply(await service.overdueCsv(), {
        type: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="overdue.csv"' },
    }));

    // ---- request pipeline ----
    function applyCors(req, res) {
        const origin = req.headers.origin;
        if (!origin) return true;
        if (!config.corsOrigins.includes(origin)) {
            logger.warn('CORS: origin not allowed', { origin, reqId: req.id });
            return false;
        }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        return true;
    }

    async function authenticate(req) {
        const payload = verifyToken(readCookie(req), config.jwtSecret);
        const user = payload && await users.findById(payload.sub);
        if (!user) throw new HttpError(401, 'Требуется вход');
        return user;
    }

    function readJson(req) {
        return new Promise((resolve, reject) => {
            const chunks = []; let size = 0; let failed = false;
            req.on('data', (c) => {
                if (failed) return;
                size += c.length;
                if (size > 1_000_000) { failed = true; reject(new HttpError(413, 'Слишком большой запрос')); return; }
                chunks.push(c);
            });
            req.on('end', () => {
                if (failed) return;
                const raw = Buffer.concat(chunks).toString('utf8');
                if (!raw.trim()) return resolve({});
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
                    resolve(parsed);
                } catch { reject(new HttpError(400, 'Некорректный JSON в теле запроса')); }
            });
            req.on('error', reject);
        });
    }

    function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
        res.end(body);
    }

    async function handle(req, res) {
        req.id = crypto.randomUUID();
        const started = process.hrtime.bigint();
        const ctx = { user: null };
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch {
            // e.g. "//" or "//[": must not throw outside the try block (it would kill the process).
            url = new URL('/invalid-url', 'http://localhost');
            ctx.badUrl = true;
        }
        res.setHeader('X-Request-Id', req.id);
        res.on('finish', () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
            logger[level]('request', { reqId: req.id, method: req.method, path: url.pathname, status: res.statusCode, ms: Math.round(ms), userId: ctx.user?.id, ip: req.socket.remoteAddress });
        });

        try {
            if (!applyCors(req, res)) throw new HttpError(403, 'Источник запроса не разрешён');
            if (ctx.badUrl) throw new HttpError(400, 'Некорректный адрес');
            if (req.method === 'OPTIONS') {
                res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                res.setHeader('Access-Control-Max-Age', '600');
                res.writeHead(204); res.end();
                return;
            }

            let known = false;
            for (const route of routes) {
                const m = route.re.exec(url.pathname);
                if (!m) continue;
                known = true;
                if (route.method !== req.method) continue;

                if (route.access !== 'public') {
                    ctx.user = await authenticate(req);
                    if (Array.isArray(route.access) && !route.access.includes(ctx.user.role)) throw new HttpError(403, 'Недостаточно прав');
                }
                const p = {};
                route.keys.forEach((k, i) => { p[k] = Number(m[i + 1]); });
                // Ids beyond PostgreSQL integer cannot exist: answer 404 instead of letting the query fail.
                if (Object.values(p).some((n) => n > 2147483647)) throw new HttpError(404, 'Ресурс не найден');
                const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
                const result = await route.fn({ p, body, query: Object.fromEntries(url.searchParams), user: ctx.user, ip: req.socket.remoteAddress });

                const reply = result instanceof Reply ? result : new Reply(result);
                const status = reply.status ?? (req.method === 'POST' ? 201 : (reply.data === undefined ? 204 : 200));
                if (reply.type) return send(res, status, reply.data, reply.type, reply.headers);
                if (status === 204 || reply.data === undefined) {
                    res.writeHead(204, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...reply.headers });
                    res.end();
                    return;
                }
                return send(res, status, JSON.stringify(reply.data), undefined, reply.headers);
            }
            throw new HttpError(known ? 405 : 404, known ? 'Метод не поддерживается' : 'Ресурс не найден');
        } catch (raw) {
            const err = fromDbError(raw);
            // Server-side causes are always logged with details, even when the client gets a friendly 503.
            if (isDbUnavailable(raw)) logger.error('database unavailable', { reqId: req.id, error: raw.message, code: raw.code });
            if (err instanceof HttpError) {
                send(res, err.status, JSON.stringify({ error: err.message }), undefined, err.status === 413 ? { Connection: 'close' } : {});
            } else {
                logger.error('unhandled error', { reqId: req.id, error: err.message, code: err.code, stack: err.stack });
                send(res, 500, JSON.stringify({ error: 'Внутренняя ошибка сервера' }));
            }
        }
    }

    const server = http.createServer((req, res) => {
        // Last line of defence: nothing thrown while handling a request may crash the process.
        handle(req, res).catch((err) => {
            logger.error('request handler crashed', { reqId: req.id, error: err.message, stack: err.stack });
            if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end('{"error":"Внутренняя ошибка сервера"}'); } else res.end();
        });
    });
    return {
        server,
        listen: (port, host = '0.0.0.0') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

module.exports = { createApp };
