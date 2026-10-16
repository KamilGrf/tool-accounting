// Google Analytics 4, loaded only when (1) VITE_GA_MEASUREMENT_ID is set and (2) the visitor has agreed.
// Without the id or the consent nothing is loaded and nothing is sent. Events carry no personal data
// (no e-mails, names or tool descriptions), and page views are sent by <PageTracker />, not automatically.

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? '';
const CONSENT_KEY = 'tool-accounting.analytics-consent';

export const isAnalyticsConfigured = /^G-[A-Z0-9]{4,}$/.test(MEASUREMENT_ID);

let loaded = false;

/** 'granted', 'denied' or null (not asked yet). Storage can be blocked: then the answer is "not asked". */
export function getConsent() {
    try {
        const value = localStorage.getItem(CONSENT_KEY);
        return value === 'granted' || value === 'denied' ? value : null;
    } catch {
        return null;
    }
}

function loadGoogleTag() {
    window.dataLayer = window.dataLayer || [];
    // gtag.js expects the arguments object itself in the data layer, not an array.
    window.gtag = function gtag() {
        window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, { send_page_view: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    document.head.appendChild(script);
}

/** Start analytics if it is configured and the visitor agreed. Safe to call many times. */
export function initAnalytics() {
    if (!isAnalyticsConfigured || getConsent() !== 'granted') return;
    window[`ga-disable-${MEASUREMENT_ID}`] = false;
    if (loaded) return;
    loaded = true;
    loadGoogleTag();
}

/** Remember the visitor's answer and apply it at once. */
export function setConsent(value) {
    try {
        localStorage.setItem(CONSENT_KEY, value);
    } catch {
        // the answer is only valid for this page view then
    }
    if (value === 'granted') {
        initAnalytics();
    } else if (isAnalyticsConfigured) {
        window[`ga-disable-${MEASUREMENT_ID}`] = true; // documented switch: gtag.js stops sending
    }
}

function send(name, params) {
    if (!loaded || getConsent() !== 'granted' || typeof window.gtag !== 'function') return;
    window.gtag('event', name, params);
}

export function trackPageView(path) {
    send('page_view', { page_path: path, page_title: document.title });
}

/** @param {string} name e.g. 'login'; @param {object} [params] numbers, booleans and short labels only */
export function trackEvent(name, params = {}) {
    send(name, params);
}

/** For tests: forget that the tag was loaded. */
export function resetAnalyticsForTests() {
    loaded = false;
}
