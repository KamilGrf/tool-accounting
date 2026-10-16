import { useState } from 'react';
import { getConsent, isAnalyticsConfigured, setConsent, trackPageView } from '../analytics.js';
import { Button } from './ui.jsx';

/** Asks once whether Google Analytics may be used. Renders nothing when analytics is not configured. */
export default function ConsentBanner() {
    const [answer, setAnswer] = useState(getConsent);
    if (!isAnalyticsConfigured || answer) return null;

    const choose = (value) => {
        setConsent(value);
        setAnswer(value);
        if (value === 'granted') trackPageView(window.location.pathname); // the page the visitor is on right now
    };

    return (
        <div
            role="region"
            aria-label="Согласие на аналитику"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white p-3 shadow-lg"
        >
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 text-sm">
                <p className="min-w-0 flex-1">
                    Сайт использует Google Analytics для обезличенной статистики посещений и действий (без email и имён). Разрешить?
                </p>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => choose('denied')}>
                        Отклонить
                    </Button>
                    <Button onClick={() => choose('granted')}>Разрешить</Button>
                </div>
            </div>
        </div>
    );
}

/** A link in the sidebar to change the answer later. Hidden until the visitor has answered. */
export function AnalyticsSetting() {
    const [answer, setAnswer] = useState(getConsent);
    if (!isAnalyticsConfigured || !answer) return null;
    const next = answer === 'granted' ? 'denied' : 'granted';
    return (
        <button
            type="button"
            className="underline hover:text-white"
            onClick={() => {
                setConsent(next);
                setAnswer(next);
            }}
        >
            {answer === 'granted' ? 'Отключить аналитику' : 'Включить аналитику'}
        </button>
    );
}
