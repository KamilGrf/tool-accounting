import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolsPage from './ToolsPage.jsx';
import { baseHandlers, mockFetch } from '../test/mockFetch.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

afterEach(() => vi.unstubAllGlobals());

describe('ToolsPage', () => {
    it('shows loading, then the list of tools with status labels', async () => {
        mockFetch(baseHandlers());
        renderWithAuth(<ToolsPage />);
        expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
        expect(await screen.findByText('Дрель ударная Bosch GSB 13 RE')).toBeInTheDocument();
        const table = within(screen.getByRole('table'));
        expect(table.getByText('Выдан')).toBeInTheDocument();
        expect(table.getByText('На складе')).toBeInTheDocument();
    });

    it('shows the empty state with a reset button when nothing matches the filters', async () => {
        const handlers = baseHandlers();
        // Tools are returned only when no search is set, so typing "zzz" yields an empty result.
        handlers['GET /api/tools'] = (url) => ({ data: url.includes('q=zzz') ? [] : baseHandlers()['GET /api/tools'].data });
        mockFetch(handlers);
        renderWithAuth(<ToolsPage />);
        await screen.findByText('Шуруповёрт Makita DF330D');
        await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск' }), 'zzz');
        expect(await screen.findByText(/Ничего не найдено/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
        expect(await screen.findByText('Шуруповёрт Makita DF330D')).toBeInTheDocument();
    });

    it('keeps the page usable on a network error and recovers after retry', async () => {
        let fail = true;
        const handlers = baseHandlers();
        handlers['GET /api/tools'] = () => (fail ? new TypeError('Failed to fetch') : { data: baseHandlers()['GET /api/tools'].data });
        mockFetch(handlers);
        renderWithAuth(<ToolsPage />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение');
        fail = false;
        await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(await screen.findByText('Шуруповёрт Makita DF330D')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('scrolls the details panel into view on narrow screens (bug found at 480px)', async () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
        mockFetch(baseHandlers());
        renderWithAuth(<ToolsPage />);
        await userEvent.click(await screen.findByText('Шуруповёрт Makita DF330D'));
        await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
        delete Element.prototype.scrollIntoView;
    });

    it('validates the issue form on the client and shows server conflicts without closing the form', async () => {
        const handlers = baseHandlers();
        handlers['POST /api/issues'] = { status: 409, data: { error: 'Инструмент нельзя выдать: он уже выдан' } };
        const { calls } = mockFetch(handlers);
        renderWithAuth(<ToolsPage />);

        await userEvent.click(await screen.findByText('Шуруповёрт Makita DF330D'));
        await userEvent.click(screen.getByRole('button', { name: 'Выдать' }));
        const dialog = await screen.findByRole('dialog');

        // Required employee: client-side message, no request sent.
        const submitBtn = within(dialog).getByRole('button', { name: 'Выдать' });
        await userEvent.click(submitBtn);
        expect(await screen.findByText('Поле «Сотрудник» обязательно для заполнения')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'POST')).toBe(false);

        // Valid input, server says 409: message shown in the form, form stays open.
        await userEvent.selectOptions(screen.getByLabelText('Сотрудник *'), '1');
        await userEvent.click(submitBtn);
        await waitFor(() => expect(screen.getByText('Инструмент нельзя выдать: он уже выдан')).toBeInTheDocument());
        expect(dialog).toBeInTheDocument();
        const post = calls.find((c) => c.method === 'POST');
        expect(post.body).toMatchObject({ tool_id: 2, employee_id: 1 });
    });
});
