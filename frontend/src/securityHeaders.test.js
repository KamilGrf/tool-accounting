// Guards the HTTP security headers configured in vercel.json: a careless edit must not weaken them.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const forAllPages = config.headers.find((h) => h.source === '/(.*)');
const header = (name) => forAllPages.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;

/** "a 'self' b; c d" -> { a: ["'self'", 'b'], c: ['d'] } */
function directives(policy) {
    return Object.fromEntries(
        policy
            .split(';')
            .map((part) => part.trim().split(/\s+/))
            .filter((tokens) => tokens[0])
            .map(([name, ...sources]) => [name, sources]),
    );
}
const csp = directives(header('Content-Security-Policy') ?? '');

describe('Content-Security-Policy', () => {
    it('is set for every page', () => {
        expect(forAllPages).toBeDefined();
        expect(Object.keys(csp).length).toBeGreaterThan(5);
    });

    it('allows scripts only from the site itself and the Google tag (no inline code, no eval)', () => {
        expect(csp['script-src']).toEqual(["'self'", 'https://www.googletagmanager.com']);
    });

    it('allows no inline styles', () => {
        expect(csp['style-src']).toEqual(["'self'"]);
    });

    it('denies plugins, framing of other sites, and framing of this one', () => {
        expect(csp['object-src']).toEqual(["'none'"]);
        expect(csp['frame-src']).toEqual(["'none'"]);
        expect(csp['frame-ancestors']).toEqual(["'none'"]);
    });

    it('pins the base address and form targets to the site', () => {
        expect(csp['base-uri']).toEqual(["'self'"]);
        expect(csp['form-action']).toEqual(["'self'"]);
        expect(csp['default-src']).toEqual(["'self'"]);
    });

    it('lets the app talk to its own Supabase project (not to every project) and Google Analytics only', () => {
        expect(csp['connect-src'].some((s) => /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(s))).toBe(true);
        expect(csp['connect-src']).not.toContain('https://*.supabase.co');
        expect(csp['connect-src']).not.toContain('wss://*.supabase.co');
        expect(csp['connect-src'].some((s) => /^wss:\/\/[a-z0-9]{20}\.supabase\.co$/.test(s))).toBe(true);
        for (const source of csp['connect-src']) expect(source).toMatch(/^('self'|https:\/\/\*?\.?[a-z0-9.-]+|wss:\/\/\*?\.?[a-z0-9.-]+)$/);
    });

    it('never uses a bare wildcard or an unencrypted source anywhere', () => {
        for (const [name, sources] of Object.entries(csp)) {
            for (const source of sources) {
                expect(source, `${name} contains ${source}`).not.toBe('*');
                expect(source, `${name} contains ${source}`).not.toMatch(/^(http|ws):/);
                expect(source, `${name} contains ${source}`).not.toMatch(/unsafe-(inline|eval)/);
            }
        }
    });
});

describe('other security headers', () => {
    it('stops MIME sniffing and framing', () => {
        expect(header('X-Content-Type-Options')).toBe('nosniff');
        expect(header('X-Frame-Options')).toBe('DENY');
    });

    it('limits what is sent in the Referer header', () => {
        expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('switches off browser features the app never uses', () => {
        const policy = header('Permissions-Policy');
        for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(policy).toContain(`${feature}=()`);
    });
});

describe('routing', () => {
    it('keeps /api out of the single-page-app rewrite, so functions are not shadowed by index.html', () => {
        const re = new RegExp(`^${config.rewrites[0].source}$`);
        for (const path of ['/', '/tools', '/report', '/privacy', '/users']) expect(re.test(path), path).toBe(true);
        for (const path of ['/api/health', '/api/anything']) expect(re.test(path), path).toBe(false);
    });

    it('never caches the answers of the functions', () => {
        const api = config.headers.find((h) => h.source === '/api/(.*)');
        expect(api.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
    });
});
