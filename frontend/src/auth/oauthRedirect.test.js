import { describe, expect, it, vi } from 'vitest';
import { clearOAuthParams, isOAuthReturn, readOAuthError } from './oauthRedirect.js';

const at = (search = '', hash = '', pathname = '/tools') => ({ search, hash, pathname });

describe('readOAuthError', () => {
    it('returns null when the URL carries no error', () => {
        expect(readOAuthError(at())).toBeNull();
        expect(readOAuthError(at('?code=abc'))).toBeNull();
    });

    it('explains that the visitor cancelled the Google dialog', () => {
        const err = readOAuthError(at('?error=access_denied&error_code=access_denied&error_description=Denied'));
        expect(err).toEqual({ code: 'access_denied', message: 'Вход через Google отменён' });
    });

    it('also reads the error from the fragment (implicit flow)', () => {
        expect(readOAuthError(at('', '#error=access_denied&error_code=access_denied')).message).toBe('Вход через Google отменён');
    });

    it('names the code of an unknown error', () => {
        const err = readOAuthError(at('?error=weird&error_code=something_new'));
        expect(err.message).toBe('Не удалось войти через Google (код: something_new)');
    });

    it('uses a friendly text for server-side failures', () => {
        expect(readOAuthError(at('?error=server_error')).message).toBe('Не удалось войти через Google. Попробуйте позже');
    });

    it('never shows provider text from a crafted link: only a cleaned code', () => {
        const err = readOAuthError(at('?error=x&error_code=%3Cscript%3Ealert(1)%3C%2Fscript%3E&error_description=Click+here'));
        expect(err.code).toBe('scriptalert1script');
        expect(err.message).toBe('Не удалось войти через Google (код: scriptalert1script)');
        expect(err.message).not.toMatch(/[<>]/);
        expect(err.message).not.toContain('Click');
    });

    it('limits the length of the code', () => {
        expect(readOAuthError(at(`?error=x&error_code=${'a'.repeat(200)}`)).code).toHaveLength(40);
    });
});

describe('isOAuthReturn / clearOAuthParams', () => {
    it('recognizes the one-time code of a successful redirect', () => {
        expect(isOAuthReturn(at('?code=abc123'))).toBe(true);
        expect(isOAuthReturn(at('?other=1'))).toBe(false);
    });

    it('cleans the address bar down to the path', () => {
        const history = { replaceState: vi.fn() };
        clearOAuthParams(at('?error=access_denied', '', '/tools'), history);
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/tools');
    });
});
