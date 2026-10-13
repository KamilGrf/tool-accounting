'use strict';
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { Database } = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const { createApp } = require('./app');

async function main() {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const db = new Database(config.databaseUrl, { timezone: config.timezone, onError: (err) => logger.error('database pool error', { error: err.message }) });

    await waitForDatabase(db, logger);
    await migrate(db, logger);
    await seed(db, logger);

    process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { error: String(reason && reason.message || reason), stack: reason && reason.stack }));
    process.on('uncaughtException', (err) => { logger.error('uncaught exception', { error: err.message, stack: err.stack }); process.exit(1); });

    const app = createApp({ config, db, logger });
    const port = await app.listen(config.port);
    logger.info('api started', { port, corsOrigins: config.corsOrigins, registration: config.allowRegistration });

    const shutdown = async (signal) => {
        logger.info('shutting down', { signal });
        await app.close();
        await db.close();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

/** The database container may still be starting: retry for up to ~30 seconds. */
async function waitForDatabase(db, logger, attempts = 30) {
    for (let i = 1; i <= attempts; i++) {
        try { await db.get('SELECT 1'); return; } catch (err) {
            logger.warn('database not ready', { attempt: i, error: err.message });
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    throw new Error('Database is not reachable');
}

main().catch((err) => {
    createLogger().error('fatal', { error: err.message });
    process.exit(1);
});
