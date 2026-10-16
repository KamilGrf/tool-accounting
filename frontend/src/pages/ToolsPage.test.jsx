import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolsPage from './ToolsPage.jsx';
import { ApiError, NetworkError } from '../api/client.js';
import { TOOLS, api, resetApi } from '../test/mockApi.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

vi.mock('../api/index.js', async () => (await import('../test/mockApi.js')).api);
beforeEach(resetApi);

describe('ToolsPage', () => {
    it('shows loading, then the list of tools with status labels', async () => {
        renderWithAuth(<ToolsPage />);
        expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
        expect(await screen.findByText('Дрель ударная Bosch GSB 13 RE')).toBeInTheDocument();
        const table = within(screen.getByRole('table'));
        expect(table.getByText('Выдан')).toBeInTheDocument();
        expect(table.getByText('На складе')).toBeInTheDocument();
    });

    it('shows the empty state with a reset button when nothing matches the filters', async () => {
        // Tools are returned only when no search is set, so typing "zzz" yields an empty result.
        api.toolsApi.list.mockImplementation(async ({ q }) => (q === 'zzz' ? [] : TOOLS));
        renderWithAuth(<ToolsPage />);
        await screen.findByText('Шуруповёрт Makita DF330D');
        await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск' }), 'zzz');
        expect(await screen.findByText(/Ничего не найдено/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
        expect(await screen.findByText('Шуруповёрт Makita DF330D')).toBeInTheDocument();
    });

    it('keeps the page usable on a network error and recovers after retry', async () => {
        api.toolsApi.list.mockRejectedValueOnce(new NetworkError());
        renderWithAuth(<ToolsPage />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение');
        await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(await screen.findByText('Шуруповёрт Makita DF330D')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('scrolls the details panel into view on narrow screens (bug found at 480px)', async () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
        renderWithAuth(<ToolsPage />);
        await userEvent.click(await screen.findByText('Шуруповёрт Makita DF330D'));
        await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
        delete Element.prototype.scrollIntoView;
        vi.unstubAllGlobals();
    });

    it('validates the issue form on the client and shows server conflicts without closing the form', async () => {
        api.issuesApi.issue.mockRejectedValue(new ApiError(409, 'Инструмент нельзя выдать: он уже выдан'));
        renderWithAuth(<ToolsPage />);

        await userEvent.click(await screen.findByText('Шуруповёрт Makita DF330D'));
        await userEvent.click(screen.getByRole('button', { name: 'Выдать' }));
        const dialog = await screen.findByRole('dialog');

        // Required employee: client-side message, nothing is sent.
        const submitBtn = within(dialog).getByRole('button', { name: 'Выдать' });
        await userEvent.click(submitBtn);
        expect(await screen.findByText('Поле «Сотрудник» обязательно для заполнения')).toBeInTheDocument();
        expect(api.issuesApi.issue).not.toHaveBeenCalled();

        // Valid input, the database says 409: message shown in the form, form stays open.
        await userEvent.selectOptions(screen.getByLabelText('Сотрудник *'), '1');
        await userEvent.click(submitBtn);
        await waitFor(() => expect(screen.getByText('Инструмент нельзя выдать: он уже выдан')).toBeInTheDocument());
        expect(dialog).toBeInTheDocument();
        expect(api.issuesApi.issue).toHaveBeenCalledWith(expect.objectContaining({ tool_id: 2, employee_id: 1 }));
    });
});
