import { describe, expect, it } from 'vitest';
import { daysOverdue, formatDate, todayIso } from './format.js';

describe('format utils', () => {
    it('formats ISO dates for display and handles empty values', () => {
        expect(formatDate('2026-10-13')).toBe('13.10.2026');
        expect(formatDate(null)).toBe('—');
    });

    it('computes local dates with an offset, across month boundaries', () => {
        const now = new Date(2026, 9, 28, 23, 30); // 28 Oct 2026, late evening local time
        expect(todayIso(0, now)).toBe('2026-10-28');
        expect(todayIso(7, now)).toBe('2026-11-04');
    });

    it('counts overdue days; zero on the due date, negative before it', () => {
        expect(daysOverdue('2026-10-10', '2026-10-13')).toBe(3);
        expect(daysOverdue('2026-10-13', '2026-10-13')).toBe(0);
        expect(daysOverdue('2026-10-20', '2026-10-13')).toBe(-7);
    });
});
