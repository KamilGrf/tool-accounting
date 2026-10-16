import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage.jsx';
import { ApiError, NetworkError } from '../api/client.js';
import { api, resetApi } from '../test/mockApi.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

vi.mock('../api/index.js', async () => (await import('../test/mockApi.js')).api);
beforeEach(() => {
    resetApi();
    vi.restoreAllMocks();
});

const USERS = [
    { id: 'p1', email: 'new@test.ru', role: 'pending', created_at: '2026-10-17T08:00:00+00:00', email_confirmed: false },
    { id: 'u1', email: 'boss@test.ru', role: 'manager', created_at: '2026-10-10T08:00:00+00:00' },
    { id: 's1', email: 'keeper@test.ru', role: 'storekeeper', created_at: '2026-10-11T08:00:00+00:00' },
];
const asBoss = () => renderWithAuth(<UsersPage />, { id: 'u1', login: 'boss@test.ru', role: 'manager' });
const rowOf = (email) => screen.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) });

describe('UsersPage', () => {
    beforeEach(() => api.usersApi.list.mockResolvedValue(USERS));

    it('lists the accounts with their roles and says how many wait for approval', async () => {
        asBoss();
        expect(await screen.findByText('new@test.ru')).toBeInTheDocument();
        expect(screen.getByText(/ожидают: 1/)).toBeInTheDocument();
        expect(within(rowOf('new@test.ru')).getByText('Ожидает подтверждения')).toBeInTheDocument();
        expect(within(rowOf('keeper@test.ru')).getByText('Кладовщик')).toBeInTheDocument();
    });

    it('marks accounts whose e-mail is not confirmed, and only those', async () => {
        asBoss();
        await screen.findByText('new@test.ru');
        expect(within(rowOf('new@test.ru')).getByText('почта не подтверждена')).toBeInTheDocument();
        expect(within(rowOf('keeper@test.ru')).queryByText('почта не подтверждена')).not.toBeInTheDocument();
    });

    it('offers no buttons for the own account: nobody can change his own role', async () => {
        asBoss();
        await screen.findByText('boss@test.ru');
        expect(within(rowOf('boss@test.ru')).getByText('это вы')).toBeInTheDocument();
        expect(within(rowOf('boss@test.ru')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('approves a pending account as a storekeeper and reloads the list', async () => {
        asBoss();
        await userEvent.click(await screen.findByRole('button', { name: 'Кладовщик: new@test.ru' }));
        expect(api.usersApi.setRole).toHaveBeenCalledWith('p1', 'storekeeper');
        await waitFor(() => expect(api.usersApi.list).toHaveBeenCalledTimes(2));
    });

    it('asks for confirmation before giving manager rights, and does nothing when declined', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        asBoss();
        await userEvent.click(await screen.findByRole('button', { name: 'Руководитель: new@test.ru' }));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('new@test.ru'));
        expect(api.usersApi.setRole).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        await userEvent.click(screen.getByRole('button', { name: 'Руководитель: new@test.ru' }));
        expect(api.usersApi.setRole).toHaveBeenCalledWith('p1', 'manager');
    });

    it('closes the access of a storekeeper without extra questions', async () => {
        const confirm = vi.spyOn(window, 'confirm');
        asBoss();
        await userEvent.click(await screen.findByRole('button', { name: 'Закрыть доступ: keeper@test.ru' }));
        expect(api.usersApi.setRole).toHaveBeenCalledWith('s1', 'pending');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('does not offer the role a user already has', async () => {
        asBoss();
        await screen.findByText('keeper@test.ru');
        expect(screen.queryByRole('button', { name: 'Кладовщик: keeper@test.ru' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Закрыть доступ: new@test.ru' })).not.toBeInTheDocument();
    });

    it('shows the database refusal and keeps the list', async () => {
        api.usersApi.setRole.mockRejectedValue(new ApiError(403, 'Недостаточно прав'));
        asBoss();
        await userEvent.click(await screen.findByRole('button', { name: 'Кладовщик: new@test.ru' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав');
        expect(screen.getByText('new@test.ru')).toBeInTheDocument();
    });

    it('recovers from a failed load with the retry button', async () => {
        api.usersApi.list.mockRejectedValueOnce(new NetworkError());
        asBoss();
        expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение');
        await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(await screen.findByText('new@test.ru')).toBeInTheDocument();
    });

    it('says so when there are no accounts', async () => {
        api.usersApi.list.mockResolvedValue([]);
        asBoss();
        expect(await screen.findByText('Пользователей нет')).toBeInTheDocument();
    });
});
