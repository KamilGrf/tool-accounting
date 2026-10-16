import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initAnalytics, trackPageView } from '../analytics.js';

/** Sends a page view on every route change (a single-page app has no real page loads). Renders nothing. */
export default function PageTracker() {
    const { pathname } = useLocation();
    useEffect(() => {
        initAnalytics();
        trackPageView(pathname);
    }, [pathname]);
    return null;
}
