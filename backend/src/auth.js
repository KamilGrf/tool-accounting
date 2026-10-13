'use strict';
// Authentication primitives built on node:crypto only (no extra dependencies):
// scrypt password hashing and HS256 JWT in an HttpOnly cookie.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;
const COOKIE_NAME = 'session';

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, KEY_LEN);
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    const [scheme, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload, secret, ttlSeconds, now = Date.now()) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds }));
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

/** Returns the payload, or null for a malformed, forged or expired token. */
function verifyToken(token, secret, now = Date.now()) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    try {
        if (JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') return null; // reject "none" etc.
        const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
        const given = Buffer.from(sig, 'base64url');
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url'));
        return payload.exp * 1000 > now ? payload : null;
    } catch {
        return null;
    }
}

function readCookie(req, name = COOKIE_NAME) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) {
            try { return decodeURIComponent(v.join('=')); } catch { return null; } // malformed %-escape
        }
    }
    return null;
}

function sessionCookie(token, { secure, maxAge }) {
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie({ secure }) {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, readCookie, sessionCookie, clearCookie };
