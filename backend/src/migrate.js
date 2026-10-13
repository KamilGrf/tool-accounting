'use strict';
// Minimal migration runner: applies migrations/*.sql in name order, each in a transaction,
// and records applied names in schema_migrations. Safe to run repeatedly.
const fs = require('node:fs');
const path = require('node:path');

async function migrate(db, logger, dir = path.join(__dirname, '..', 'migrations')) {
    await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await db.all('SELECT name FROM schema_migrations')).map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        await db.transaction(async (tx) => {
            await tx.run(sql);
            await tx.run('INSERT INTO schema_migrations(name) VALUES ($1)', file);
        });
        logger.info('migration applied', { file });
    }
}

module.exports = { migrate };

if (require.main === module) {
    const { Database } = require('./db');
    const { createLogger } = require('./logger');
    const logger = createLogger();
    const db = new Database(process.env.DATABASE_URL);
    migrate(db, logger)
        .then(() => db.close())
        .catch((err) => { logger.error('migration failed', { error: err.message }); process.exit(1); });
}
