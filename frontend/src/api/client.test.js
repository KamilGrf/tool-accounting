import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, AUTH_EXPIRED, NetworkError, run, toApiError, toAuthError } from './client.js';

afterEach(() => vi.restoreAllMocks());

describe('toApiError (database and PostgREST errors)', () => {
    it('passes the user-facing message of our own database errors and maps the status', () => {
        const cases = [
            ['P0400', 400],
            ['P0403', 403],
            ['P0404', 404],
            ['P0409', 409],
        ];
        for (const [code, status] of cases) {
            const err = toApiError({ code, message: 'Инструмент нельзя выдать: он уже выдан' });
            expect(err).toBeInstanceOf(ApiError);
            expect(err.status).toBe(status);
            expect(err.message).toBe('Инструмент нельзя выдать: он уже выдан');
        }
    });

    it('explains a unique violation by the constraint that was hit', () => {
        const dup = toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "ux_tools_inv_number"' });
        expect(dup.status).toBe(409);
        expect(dup.message).toBe('Инструмент с таким инвентарным номером уже есть');
        expect(toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "something_else"' }).message).toBe(
            'Такая запись уже существует',
        );
    });

    it('maps row-level security and privilege errors to "no permission"', () => {
        const err = toApiError({ code: '42501', message: 'permission denied for table tools' });
        expect(err.status).toBe(403);
        expect(err.message).toBe('Недостаточно прав');
    });

    it('turns check-constraint and type errors into a generic validation message', () => {
        for (const code of ['23514', '22001', '22P02', '22003']) {
            const err = toApiError({ code, message: 'new row for relation "tools" violates check constraint "tools_name_chk"' });
            expect(err.status).toBe(400);
            expect(err.message).toBe('Некорректные данные в запросе');
        }
    });

    it('does not leak internals of unexpected errors', () => {
        const err = toApiError({ code: 'XX000', message: 'relation "secret_table" does not exist at character 42' });
        expect(err.status).toBe(500);
        expect(err.message).toBe('Внутренняя ошибка сервера. Попробуйте позже');
    });

    it('reports an expired token as 401 and tells the auth context', () => {
        const listener = vi.fn();
        window.addEventListener(AUTH_EXPIRED, listener);
        const err = toApiError({ code: 'PGRST301', message: 'JWT expired' });
        window.removeEventListener(AUTH_EXPIRED, listener);
        expect(err.status).toBe(401);
        expect(listener).toHaveBeenCalledOnce();
    });

    it('treats "no rows" from .single() as 404', () => {
        expect(toApiError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }).status).toBe(404);
    });

    it('recognizes a failed or timed-out request as NetworkError (ERR-NET-01)', () => {
        expect(toApiError({ message: 'TypeError: Failed to fetch', code: '' })).toBeInstanceOf(NetworkError);
        expect(toApiError(new DOMException('signal is aborted without reason', 'AbortError'))).toBeInstanceOf(NetworkError);
    });
});

describe('toAuthError (Supabase Auth errors)', () => {
    it('maps the known codes to Russian messages', () => {
        expect(toAuthError({ code: 'invalid_credentials', status: 400 })).toMatchObject({
            status: 401,
            message: 'Неверный email или пароль',
        });
        expect(toAuthError({ code: 'user_already_exists', status: 422 })).toMatchObject({ status: 409 });
        expect(toAuthError({ code: 'signup_disabled', status: 422 })).toMatchObject({ status: 403, message: 'Регистрация отключена' });
        expect(toAuthError({ code: 'over_request_rate_limit', status: 429 })).toMatchObject({ status: 429 });
    });

    it('explains mailer failures that block registration when e-mail confirmation is on', () => {
        const notAllowed = toAuthError({ code: 'email_address_not_authorized', status: 400 });
        expect(notAllowed.status).toBe(403);
        expect(notAllowed.message).toContain('подтверждение email');
        expect(toAuthError({ code: 'unexpected_failure', status: 500 }).message).toContain('письмо подтверждения');
    });

    it('names the code of an unknown error so it can be found in the Auth logs', () => {
        expect(toAuthError({ code: 'brand_new_code', status: 400 }).message).toBe(
            'Не удалось выполнить операцию (код: brand_new_code). Попробуйте позже',
        );
        expect(toAuthError({ status: 400 }).message).toBe('Не удалось выполнить операцию. Попробуйте позже');
    });

    it('recognizes a lost connection', () => {
        expect(toAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBeInstanceOf(NetworkError);
    });

    it('hides the details of unknown errors', () => {
        const err = toAuthError({ code: 'unexpected', status: 500, message: 'internal stack trace' });
        expect(err.status).toBe(500);
        expect(err.message).not.toContain('stack');
    });
});

describe('run', () => {
    it('returns the data of a successful request', async () => {
        expect(await run(Promise.resolve({ data: [{ id: 1 }], error: null }))).toEqual([{ id: 1 }]);
    });

    it('throws a converted error when the response carries one', async () => {
        const err = await run(Promise.resolve({ data: null, error: { code: 'P0409', message: 'Инструмент уже возвращён' } })).catch(
            (e) => e,
        );
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(409);
    });

    it('converts a thrown failure too', async () => {
        await expect(run(Promise.reject(new TypeError('Failed to fetch')))).rejects.toBeInstanceOf(NetworkError);
    });
});
