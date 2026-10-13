'use strict';
// All configuration comes from environment variables; secrets are never hard-coded.

function loadConfig(env = process.env) {
    const required = (name) => {
        const v = env[name];
        if (!v) throw new Error(`Environment variable ${name} is required`);
        return v;
    };
    const jwtSecret = required('JWT_SECRET');
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');

    return {
        port: Number(env.PORT || 3001),
        databaseUrl: required('DATABASE_URL'),
        jwtSecret,
        sessionTtlSeconds: 8 * 3600,
        // Origins allowed to call the API from a browser (CORS allow-list).
        corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        cookieSecure: env.COOKIE_SECURE === 'true',
        // Fail closed: open registration must be switched on explicitly.
        allowRegistration: env.ALLOW_REGISTRATION === 'true',
        loginIpFailureLimit: 20,
        timezone: env.TZ || '',
        maxFailedLogins: 5,
        lockMinutes: 15,
        logLevel: env.LOG_LEVEL || 'info',
    };
}

module.exports = { loadConfig };
