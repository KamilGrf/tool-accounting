import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads its settings when it is loaded, so every test loads a fresh copy.
async function load({ id = 'G-TEST1234', consent = null } = {}) {
    vi.resetModules();
    if (id) vi.stubEnv('VITE_GA_MEASUREMENT_ID', id);
    if (consent) localStorage.setItem('tool-accounting.analytics-consent', consent);
    return import('./analytics.js');
}

const gaScripts = () => [...document.head.querySelectorAll('script[src*="googletagmanager"]')];
const dataLayerEvents = () => (window.dataLayer || []).map((entry) => [...entry]).filter(([kind]) => kind === 'event');

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllEnvs();
    gaScripts().forEach((s) => s.remove());
    delete window.dataLayer;
    delete window.gtag;
    delete window['ga-disable-G-TEST1234'];
});

describe('analytics', () => {
    it('does nothing when the measurement id is not set', async () => {
        const a = await load({ id: '', consent: 'granted' });
        expect(a.isAnalyticsConfigured).toBe(false);
        a.initAnalytics();
        a.trackEvent('login');
        expect(gaScripts()).toHaveLength(0);
        expect(window.dataLayer).toBeUndefined();
    });

    it('rejects a malformed id', async () => {
        const a = await load({ id: 'UA-123', consent: 'granted' });
        expect(a.isAnalyticsConfigured).toBe(false);
    });

    it('loads nothing and sends nothing before the visitor agrees', async () => {
        const a = await load();
        expect(a.getConsent()).toBeNull();
        a.initAnalytics();
        a.trackEvent('login', { method: 'email' });
        a.trackPageView('/tools');
        expect(gaScripts()).toHaveLength(0);
        expect(window.dataLayer).toBeUndefined();
    });

    it('loads the Google tag once and sends events after consent', async () => {
        const a = await load({ consent: 'granted' });
        a.initAnalytics();
        a.initAnalytics(); // repeated calls must not add a second tag
        expect(gaScripts()).toHaveLength(1);
        expect(gaScripts()[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST1234');

        a.trackEvent('tool_issued');
        a.trackPageView('/report');
        expect(dataLayerEvents()).toEqual([
            ['event', 'tool_issued', {}],
            ['event', 'page_view', { page_path: '/report', page_title: document.title }],
        ]);
        // page views are sent by the app itself, not automatically
        expect(window.dataLayer.some((e) => e[0] === 'config' && e[2].send_page_view === false)).toBe(true);
    });

    it('starts as soon as consent is given', async () => {
        const a = await load();
        a.setConsent('granted');
        expect(a.getConsent()).toBe('granted');
        expect(gaScripts()).toHaveLength(1);
        a.trackEvent('login');
        expect(dataLayerEvents()).toHaveLength(1);
    });

    it('stops sending after a refusal and uses the documented disable switch', async () => {
        const a = await load({ consent: 'granted' });
        a.initAnalytics();
        a.setConsent('denied');
        expect(window['ga-disable-G-TEST1234']).toBe(true);
        a.trackEvent('login');
        expect(dataLayerEvents()).toHaveLength(0);
    });

    it('treats blocked storage as "not asked yet"', async () => {
        const a = await load({ consent: 'granted' });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(a.getConsent()).toBeNull();
        a.initAnalytics();
        expect(gaScripts()).toHaveLength(0);
        vi.restoreAllMocks();
    });
});
