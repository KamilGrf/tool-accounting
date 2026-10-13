import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { baseHandlers, mockFetch } from './test/mockFetch.js';

afterEach(() => vi.unstubAllGlobals());

const renderApp = (path = '/tools') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const as = (role) => ({ 'GET /api/auth/me': { data: { id: 1, login: 'ivan', role } }, ...baseHandlers() });

describe('authentication and roles', () => {
    it('shows the login screen when there is no session (401 from /me)', async () => {
        mockFetch({ 'GET /api/auth/me': { status: 401, data: { error: 'Требуется вход' } } });
        renderApp();
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(screen.queryByText('Инструменты')).not.toBeInTheDocument();
    });

    it('wrong password: shows the server message, keeps the login, clears the password', async () => {
        mockFetch({
            'GET /api/auth/me': { status: 401, data: { error: 'Требуется вход' } },
            'POST /api/auth/login': { status: 401, data: { error: 'Неверный логин или пароль' } },
        });
        renderApp();
        await userEvent.type(await screen.findByLabelText('Логин'), 'ivan');
        await userEvent.type(screen.getByLabelText('Пароль'), 'wrong-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
        expect(await screen.findByText('Неверный логин или пароль')).toBeInTheDocument();
        expect(screen.getByLabelText('Логин')).toHaveValue('ivan');
        expect(screen.getByLabelText('Пароль')).toHaveValue('');
    });

    it('validates required fields on the client without sending a request', async () => {
        const { calls } = mockFetch({ 'GET /api/auth/me': { status: 401, data: { error: 'Требуется вход' } } });
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Войти' }));
        expect(await screen.findByText('Поле «Логин» обязательно для заполнения')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('manager sees the Report link; storekeeper does not and gets "no access" on /report', async () => {
        mockFetch(as('manager'));
        const { unmount } = renderApp();
        expect(await screen.findByRole('link', { name: 'Отчёт' })).toBeInTheDocument();
        unmount();

        mockFetch(as('storekeeper'));
        renderApp('/report');
        expect(await screen.findByTestId('whoami')).toHaveTextContent('Кладовщик');
        expect(screen.queryByRole('link', { name: 'Отчёт' })).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Недостаточно прав');
    });

    it('a 401 from any data request returns the user to the login screen with a notice', async () => {
        mockFetch({
            ...as('manager'),
            'GET /api/tools': { status: 401, data: { error: 'Требуется вход' } },
        });
        renderApp();
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сессия истекла. Войдите снова'));
    });

    it('logout calls the API and shows the login screen', async () => {
        const { calls } = mockFetch({ ...as('manager'), 'POST /api/auth/logout': { status: 204 } });
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/api/auth/logout')).toBe(true);
    });
});
