import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { ApiError, AUTH_EXPIRED } from './api/client.js';
import { api, resetApi } from './test/mockApi.js';

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn(), trackPageView: vi.fn(), initAnalytics: vi.fn() }));
vi.mock('./analytics.js', () => ({ isAnalyticsConfigured: false, getConsent: () => null, setConsent: vi.fn(), ...analytics }));

vi.mock('./api/index.js', async () => (await import('./test/mockApi.js')).api);
beforeEach(() => {
    resetApi();
    analytics.trackEvent.mockClear();
    window.history.replaceState(null, '', '/');
});

const renderApp = (path = '/tools') =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <App />
        </MemoryRouter>,
    );
const signedInAs = (role) => api.authApi.me.mockResolvedValue({ id: 'u1', login: 'ivan@test.ru', role });

describe('authentication and roles', () => {
    it('shows the login screen when there is no session', async () => {
        renderApp();
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(screen.queryByText('Инструменты')).not.toBeInTheDocument();
    });

    it('wrong password: shows the server message, keeps the email, clears the password', async () => {
        api.authApi.login.mockRejectedValue(new ApiError(401, 'Неверный email или пароль'));
        renderApp();
        await userEvent.type(await screen.findByLabelText('Email'), 'ivan@test.ru');
        await userEvent.type(screen.getByLabelText('Пароль'), 'wrong-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
        expect(await screen.findByText('Неверный email или пароль')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toHaveValue('ivan@test.ru');
        expect(screen.getByLabelText('Пароль')).toHaveValue('');
        expect(api.authApi.login).toHaveBeenCalledWith({ email: 'ivan@test.ru', password: 'wrong-pass' });
    });

    it('validates the email and the password on the client without sending a request', async () => {
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Войти' }));
        expect(await screen.findByText('Поле «Email» обязательно для заполнения')).toBeInTheDocument();
        expect(screen.getByText('Поле «Пароль» обязательно для заполнения')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
        await userEvent.type(screen.getByLabelText('Пароль'), 'secret-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
        expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
        expect(api.authApi.login).not.toHaveBeenCalled();
    });

    it('registration needs a password of at least 8 characters', async () => {
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: /Зарегистрироваться/ }));
        await userEvent.type(screen.getByLabelText('Email'), 'new@test.ru');
        await userEvent.type(screen.getByLabelText('Пароль'), 'short');
        await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
        expect(await screen.findByText('Пароль должен быть не короче 8 символов')).toBeInTheDocument();
        expect(api.authApi.register).not.toHaveBeenCalled();
    });

    it('registration that needs e-mail confirmation asks to check the mailbox and does not sign in', async () => {
        api.authApi.register.mockResolvedValue({ needsConfirmation: true });
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: /Зарегистрироваться/ }));
        await userEvent.type(screen.getByLabelText('Email'), 'new@test.ru');
        await userEvent.type(screen.getByLabelText('Пароль'), 'long-enough-1');
        await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Проверьте почту');
        expect(api.authApi.register).toHaveBeenCalledWith({ email: 'new@test.ru', password: 'long-enough-1' });
        expect(screen.queryByRole('link', { name: 'Инструменты' })).not.toBeInTheDocument();
    });

    it('manager sees the Report link; storekeeper does not and gets "no access" on /report', async () => {
        signedInAs('manager');
        const { unmount } = renderApp();
        expect(await screen.findByRole('link', { name: 'Отчёт' })).toBeInTheDocument();
        unmount();

        signedInAs('storekeeper');
        renderApp('/report');
        expect(await screen.findByTestId('whoami')).toHaveTextContent('Кладовщик');
        expect(screen.queryByRole('link', { name: 'Отчёт' })).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Недостаточно прав');
    });

    it('an expired API session returns the user to the login screen with a notice', async () => {
        signedInAs('manager');
        renderApp();
        await screen.findByTestId('whoami');
        act(() => {
            window.dispatchEvent(new Event(AUTH_EXPIRED));
        });
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сессия истекла. Войдите снова'));
    });

    it('a session that ends by itself (refresh failed) is handled the same way', async () => {
        signedInAs('manager');
        renderApp();
        await screen.findByTestId('whoami');
        const [onEnd] = api.authApi.onSessionEnd.mock.calls[0];
        act(() => onEnd());
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Сессия истекла');
    });

    it('logout calls the API and shows the login screen without an "expired" notice', async () => {
        signedInAs('manager');
        // Supabase fires its "signed out" event for our own sign-out too.
        api.authApi.logout.mockImplementation(async () => {
            api.authApi.onSessionEnd.mock.calls[0][0]();
        });
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(api.authApi.logout).toHaveBeenCalledOnce();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('explains how to configure the app when the Supabase variables are missing', () => {
        api.isConfigured = false;
        renderApp();
        expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL');
        expect(api.authApi.me).not.toHaveBeenCalled();
    });
});

describe('Google sign-in and analytics events', () => {
    it('shows the Google button when the provider is switched on and starts the redirect on click', async () => {
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Войти через Google' }));
        expect(api.authApi.loginWithGoogle).toHaveBeenCalledOnce();
    });

    it('hides the Google button when the provider is switched off in the project', async () => {
        api.authApi.oauthProviders.mockResolvedValue({ google: false });
        renderApp();
        await screen.findByRole('button', { name: 'Войти' });
        expect(screen.queryByRole('button', { name: 'Войти через Google' })).not.toBeInTheDocument();
    });

    it('shows an error when the redirect to Google cannot be started', async () => {
        api.authApi.loginWithGoogle.mockRejectedValue(
            new ApiError(400, 'Не удалось выполнить операцию (код: validation_failed). Попробуйте позже'),
        );
        renderApp();
        await userEvent.click(await screen.findByRole('button', { name: 'Войти через Google' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('validation_failed');
    });

    it('explains a cancelled Google dialog and cleans the address bar', async () => {
        window.history.replaceState(null, '', '/?error=access_denied&error_code=access_denied&error_description=Denied');
        renderApp();
        await screen.findByRole('button', { name: 'Войти' }); // the loading spinner also has the role "status"
        expect(screen.getByRole('status')).toHaveTextContent('Вход через Google отменён');
        expect(window.location.search).toBe('');
    });

    it('reports a login with the method "google" when the visitor comes back with a session', async () => {
        window.history.replaceState(null, '', '/?code=one-time-code');
        signedInAs('storekeeper');
        renderApp();
        await screen.findByTestId('whoami');
        expect(analytics.trackEvent).toHaveBeenCalledWith('login', { method: 'google' });
    });

    it('does not report a Google login for an ordinary page load with a saved session', async () => {
        signedInAs('storekeeper');
        renderApp();
        await screen.findByTestId('whoami');
        expect(analytics.trackEvent).not.toHaveBeenCalled();
    });

    it('reports e-mail sign-in without any personal data', async () => {
        renderApp();
        await userEvent.type(await screen.findByLabelText('Email'), 'ivan@test.ru');
        await userEvent.type(screen.getByLabelText('Пароль'), 'long-enough-1');
        await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
        await screen.findByTestId('whoami');
        expect(analytics.trackEvent).toHaveBeenCalledWith('login', { method: 'email' });
        expect(JSON.stringify(analytics.trackEvent.mock.calls)).not.toContain('ivan@test.ru');
    });

    it('does not report a login that failed', async () => {
        api.authApi.login.mockRejectedValue(new ApiError(401, 'Неверный email или пароль'));
        renderApp();
        await userEvent.type(await screen.findByLabelText('Email'), 'ivan@test.ru');
        await userEvent.type(screen.getByLabelText('Пароль'), 'wrong-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
        await screen.findByText('Неверный email или пароль');
        expect(analytics.trackEvent).not.toHaveBeenCalled();
    });
});

describe('privacy policy page', () => {
    it('is public: opens without signing in and without asking for a login', async () => {
        renderApp('/privacy');
        expect(await screen.findByRole('heading', { name: 'Политика конфиденциальности' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Какие данные обрабатываются' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Войти' })).not.toBeInTheDocument();
    });

    it('opens for a signed-in user too and does not cut the session', async () => {
        signedInAs('storekeeper');
        renderApp('/privacy');
        expect(await screen.findByRole('heading', { name: 'Политика конфиденциальности' })).toBeInTheDocument();
        expect(screen.queryByTestId('whoami')).not.toBeInTheDocument();
    });

    it('is linked from the login page', async () => {
        renderApp();
        const link = await screen.findByRole('link', { name: 'Политика конфиденциальности' });
        expect(link).toHaveAttribute('href', '/privacy');
    });

    it('says what is collected and who receives it', async () => {
        renderApp('/privacy');
        const text = (await screen.findByRole('main')).textContent;
        for (const word of ['Supabase', 'Vercel', 'Google Analytics', 'localStorage']) expect(text).toContain(word);
    });
});
