// What the browser finds in the address bar after Google (through Supabase) sends it back:
// either a one-time code (success, PKCE) or an error in the query string or the fragment.

const MESSAGES = {
    access_denied: 'Вход через Google отменён',
    signup_disabled: 'Регистрация отключена',
    server_error: 'Не удалось войти через Google. Попробуйте позже',
    unexpected_failure: 'Не удалось войти через Google. Попробуйте позже',
};

const paramsOf = (location) => ({
    query: new URLSearchParams(location.search),
    hash: new URLSearchParams(location.hash.replace(/^#/, '')),
});

/**
 * The error carried by the URL after a failed redirect, or null.
 * The provider's own description is never shown: the URL can be crafted by anyone, so only the (cleaned) code is used.
 */
export function readOAuthError(location = window.location) {
    const { query, hash } = paramsOf(location);
    const error = query.get('error') || hash.get('error');
    if (!error) return null;
    const raw = query.get('error_code') || hash.get('error_code') || error;
    const code = raw.replace(/[^a-z0-9_]/gi, '').slice(0, 40);
    return { code, message: MESSAGES[code] || MESSAGES[error] || `Не удалось войти через Google (код: ${code})` };
}

/** True when the URL carries the one-time code of a successful redirect. */
export function isOAuthReturn(location = window.location) {
    return new URLSearchParams(location.search).has('code');
}

/** Drop the parameters from the address bar so a reload does not show the message again. */
export function clearOAuthParams(location = window.location, history = window.history) {
    history.replaceState(null, '', location.pathname);
}
