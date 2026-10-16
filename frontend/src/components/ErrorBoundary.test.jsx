import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';
import { setLogLevel } from '../logger.js';

function Bomb({ explode }) {
    if (explode) throw new Error('render failed for ivan@test.ru');
    return <p>all fine</p>;
}

beforeEach(() => {
    setLogLevel('error');
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React also prints the crash
});

afterEach(() => {
    setLogLevel('silent');
    vi.restoreAllMocks();
});

const journal = () =>
    console.error.mock.calls
        .map(([line]) => line)
        .filter((line) => typeof line === 'string' && line.startsWith('{'))
        .map((line) => JSON.parse(line));

describe('ErrorBoundary', () => {
    it('renders the children when nothing goes wrong', () => {
        render(
            <ErrorBoundary>
                <Bomb explode={false} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('all fine')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a message with a reload button instead of a blank page when rendering crashes', () => {
        render(
            <ErrorBoundary>
                <Bomb explode />
            </ErrorBoundary>,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так');
        expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeInTheDocument();
    });

    it('writes the crash to the journal without personal data', () => {
        render(
            <ErrorBoundary>
                <Bomb explode />
            </ErrorBoundary>,
        );
        const [entry] = journal();
        expect(entry).toMatchObject({ level: 'error', message: 'render_crash', context: { name: 'Error' } });
        expect(entry.context.message).toBe('render failed for [email]');
        expect(entry.context.componentStack).toContain('Bomb');
    });
});
