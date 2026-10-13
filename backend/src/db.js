'use strict';
const { Pool, types } = require('pg');

// Return DATE as 'YYYY-MM-DD' (not a JS Date), NUMERIC as number, COUNT/SUM (bigint) as number.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

/** Small helper API over a pg pool or a single transaction client: all / get / run. */
class Executor {
    constructor(target) { this.target = target; }

    async all(sql, ...params) { return (await this.target.query(sql, params)).rows; }

    async get(sql, ...params) { return (await this.target.query(sql, params)).rows[0]; }

    async run(sql, ...params) { return this.target.query(sql, params); }
}

class Database extends Executor {
    constructor(connectionString, { onError, timezone } = {}) {
        // Fail fast when the database is unreachable instead of hanging for seconds.
        // `options` sets the session time zone: CURRENT_DATE (overdue logic) must follow the business time zone,
        // not whatever the database server was initialised with.
        const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, ...(timezone ? { options: `-c timezone=${timezone}` } : {}) });
        // An idle client can break (e.g. the database restarts); without a listener Node would crash.
        pool.on('error', (err) => onError && onError(err));
        super(pool);
        this.pool = pool;
    }

    /** Run `fn(tx)` in one transaction; roll back on any exception. */
    async transaction(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(new Executor(client));
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    close() { return this.pool.end(); }
}

module.exports = { Database, Executor };
