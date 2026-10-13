'use strict';
// Registration and login with brute-force protection (ТЗ ФТ-6.1, ФТ-6.4).
const { HttpError } = require('./errors');
const { hashPassword, verifyPassword } = require('./auth');
const { text } = require('./validation');

const LOGIN_RE = /^[A-Za-z0-9_.-]{3,50}$/;
// The same text for "no such user" and "wrong password": do not reveal which logins exist.
const BAD_CREDENTIALS = 'Неверный логин или пароль';
const MAX_PASSWORD = 128;

/** In-memory failure counter with a lock window (for unknown logins and per-IP limits). */
class FailureTracker {
    constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }

    isLocked(key, now = Date.now()) {
        const e = this.map.get(key);
        return Boolean(e && e.until > now);
    }

    record(key, now = Date.now()) {
        const e = this.map.get(key);
        const fresh = !e || (e.until && e.until <= now) || e.expires <= now;
        const entry = fresh ? { count: 0, until: 0, expires: now + this.windowMs } : e;
        entry.count += 1;
        if (entry.count >= this.max) entry.until = now + this.windowMs;
        this.map.set(key, entry);
        if (this.map.size > 10000) this.map.clear(); // crude memory cap
    }
}

class UserService {
    constructor(db, config, logger) {
        this.db = db;
        this.config = config;
        this.logger = logger;
        const windowMs = config.lockMinutes * 60_000;
        this.unknownLogins = new FailureTracker(config.maxFailedLogins, windowMs);
        this.ipFailures = new FailureTracker(config.loginIpFailureLimit, windowMs);
        // Verified against when the login does not exist, so response time does not leak existence.
        this.dummyHash = hashPassword('not-a-real-password');
    }

    /** Self-registration always creates a storekeeper; managers are created by the seed script. */
    async register(body) {
        if (!this.config.allowRegistration) throw new HttpError(403, 'Регистрация отключена');
        const login = text(body.login, 'Логин', { required: true, max: 50 });
        if (!LOGIN_RE.test(login)) throw new HttpError(400, 'Логин: от 3 до 50 символов — латинские буквы, цифры, «.», «_» и «-»');
        const password = typeof body.password === 'string' ? body.password : '';
        if (password.length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
        if (password.length > MAX_PASSWORD) throw new HttpError(400, `Пароль длиннее ${MAX_PASSWORD} символов`);

        try {
            const row = await this.db.get(
                "INSERT INTO users(login, password_hash, role) VALUES ($1, $2, 'storekeeper') RETURNING id, login, role",
                login, await hashPassword(password));
            return row;
        } catch (err) {
            if (err && err.code === '23505') throw new HttpError(409, 'Пользователь с таким логином уже существует');
            throw err;
        }
    }

    tooMany() {
        return new HttpError(429, `Слишком много попыток. Повторите через ${this.config.lockMinutes} минут`);
    }

    async login(body, ip) {
        const login = text(body.login, 'Логин', { required: true, max: 50 });
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) throw new HttpError(400, 'Поле «Пароль» обязательно для заполнения');

        const ipKey = `ip:${ip}`;
        const loginKey = `login:${login.toLowerCase()}`;
        if (this.ipFailures.isLocked(ipKey)) {
            this.logger.warn('login blocked: too many failures from this address', { ip });
            throw this.tooMany();
        }

        const user = await this.db.get(
            'SELECT id, login, role, password_hash, locked_until FROM users WHERE lower(login) = lower($1)', login);

        // Locked accounts and "unknown but already tried 5 times" logins look identical (no user enumeration).
        if ((user && user.locked_until && user.locked_until > new Date()) || (!user && this.unknownLogins.isLocked(loginKey))) {
            this.logger.warn('login blocked: account locked', { ip, known: Boolean(user) });
            throw this.tooMany();
        }

        // Passwords longer than the registration limit cannot be valid: skip the expensive hash.
        const ok = password.length <= MAX_PASSWORD && await verifyPassword(password, user ? user.password_hash : await this.dummyHash);
        if (!user || !ok) {
            this.ipFailures.record(ipKey);
            if (user) await this.recordFailure(user);
            else this.unknownLogins.record(loginKey);
            // The typed login is logged only for existing accounts: for unknown ones it may be a mistyped password.
            this.logger.warn('login failed', { ip, known: Boolean(user), ...(user ? { login: user.login } : {}) });
            throw new HttpError(401, BAD_CREDENTIALS);
        }
        await this.db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', user.id);
        return { id: user.id, login: user.login, role: user.role };
    }

    /** One atomic statement: parallel guesses cannot all read the same counter. */
    async recordFailure(user) {
        const { locked } = await this.db.get(
            `UPDATE users SET
                    failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
                    locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
             WHERE id = $1
             RETURNING (failed_attempts = 0) AS locked`,
            user.id, this.config.maxFailedLogins, this.config.lockMinutes);
        if (locked) this.logger.warn('account locked after repeated failures', { login: user.login });
    }

    findById(userId) {
        return this.db.get('SELECT id, login, role FROM users WHERE id = $1', userId);
    }
}

module.exports = { UserService };
