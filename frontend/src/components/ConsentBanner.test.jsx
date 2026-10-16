import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import ConsentBanner, { AnalyticsSetting } from './ConsentBanner.jsx';
import PageTracker from './PageTracker.jsx';

const analytics = vi.hoisted(() => ({
    isAnalyticsConfigured: true,
    consent: null,
    getConsent: vi.fn(),
    setConsent: vi.fn(),
    trackPageView: vi.fn(),
    initAnalytics: vi.fn(),
}));
vi.mock('../analytics.js', () => analytics);

beforeEach(() => {
    vi.clearAllMocks();
    analytics.isAnalyticsConfigured = true;
    analytics.getConsent.mockReturnValue(null);
});

describe('ConsentBanner', () => {
    it('asks before anything is sent and starts analytics on "Разрешить"', async () => {
        render(<ConsentBanner />);
        expect(screen.getByRole('region', { name: 'Согласие на аналитику' })).toHaveTextContent('Google Analytics');
        expect(analytics.setConsent).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Разрешить' }));
        expect(analytics.setConsent).toHaveBeenCalledWith('granted');
        expect(analytics.trackPageView).toHaveBeenCalledOnce(); // the page the visitor is on
        expect(screen.queryByRole('region', { name: 'Согласие на аналитику' })).not.toBeInTheDocument();
    });

    it('"Отклонить" stores the refusal and sends nothing', async () => {
        render(<ConsentBanner />);
        await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
        expect(analytics.setConsent).toHaveBeenCalledWith('denied');
        expect(analytics.trackPageView).not.toHaveBeenCalled();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('does not ask again once the visitor has answered', () => {
        analytics.getConsent.mockReturnValue('denied');
        render(<ConsentBanner />);
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('is invisible when analytics is not configured', () => {
        analytics.isAnalyticsConfigured = false;
        render(<ConsentBanner />);
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
});

describe('AnalyticsSetting', () => {
    it('lets the visitor switch analytics off and on again', async () => {
        analytics.getConsent.mockReturnValue('granted');
        render(<AnalyticsSetting />);
        await userEvent.click(screen.getByRole('button', { name: 'Отключить аналитику' }));
        expect(analytics.setConsent).toHaveBeenLastCalledWith('denied');
        await userEvent.click(screen.getByRole('button', { name: 'Включить аналитику' }));
        expect(analytics.setConsent).toHaveBeenLastCalledWith('granted');
    });

    it('stays hidden until the visitor has answered', () => {
        render(<AnalyticsSetting />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('PageTracker', () => {
    function Nav() {
        const navigate = useNavigate();
        return <button onClick={() => navigate('/report')}>go</button>;
    }

    it('starts analytics and sends a page view for the first page and for every route change', async () => {
        render(
            <MemoryRouter initialEntries={['/tools']}>
                <PageTracker />
                <Routes>
                    <Route path="*" element={<Nav />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(analytics.initAnalytics).toHaveBeenCalled();
        expect(analytics.trackPageView).toHaveBeenLastCalledWith('/tools');
        await userEvent.click(screen.getByRole('button', { name: 'go' }));
        expect(analytics.trackPageView).toHaveBeenLastCalledWith('/report');
        expect(analytics.trackPageView).toHaveBeenCalledTimes(2);
    });
});
