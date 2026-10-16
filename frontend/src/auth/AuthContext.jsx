// Session state for the whole app: who is signed in, and what happens when the session ends.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, logsApi } from '../api/index.js';
import { AUTH_EXPIRED } from '../api/client.js';
import { trackEvent } from '../analytics.js';
import { logger, setRemoteSink } from '../logger.js';
import { clearOAuthParams, isOAuthReturn, readOAuthError } from './oauthRedirect.js';

export const AuthContext = createContext(null);

const EXPIRED_NOTICE = 'Сессия истекла. Войдите снова';

export function AuthProvider({ children }) {
    // Read once, synchronously, before the client has had time to clean the address bar.
    const [redirect] = useState(() => ({ error: readOAuthError(), returned: isOAuthReturn() }));
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(true);
    const [notice, setNotice] = useState(redirect.error?.message ?? '');
    const signingOut = useRef(false); // our own sign-out also fires the "session ended" event: no notice for it

    // A failed Google redirect leaves its error in the URL: show it once, then clean the address bar.
    useEffect(() => {
        if (redirect.error) clearOAuthParams();
    }, [redirect]);

    // On start ask Supabase whether a saved session exists (it is restored from the browser storage,
    // or created from the one-time code when the visitor has just come back from Google).
    useEffect(() => {
        let alive = true;
        authApi
            .me()
            .then(
                (u) => {
                    if (!alive) return;
                    setUser(u);
                    if (redirect.returned) trackEvent('login', { method: 'google' });
                },
                () => {},
            )
            .finally(() => alive && setChecking(false));
        return () => {
            alive = false;
        };
    }, [redirect]);

    // Warnings and errors go to the central log only while somebody is signed in (the database refuses anonymous entries).
    useEffect(() => {
        setRemoteSink(user ? logsApi.send : null);
    }, [user]);

    // The session ended by itself (refresh failed, signed out in another tab) or an API call got 401.
    useEffect(() => {
        const onExpired = () => {
            if (signingOut.current) return;
            setUser((current) => {
                if (current) setNotice(EXPIRED_NOTICE);
                return null;
            });
        };
        const stopListening = authApi.onSessionEnd(onExpired);
        window.addEventListener(AUTH_EXPIRED, onExpired);
        return () => {
            stopListening();
            window.removeEventListener(AUTH_EXPIRED, onExpired);
        };
    }, []);

    const signIn = useCallback(async (mode, credentials) => {
        let result;
        try {
            result = await (mode === 'register' ? authApi.register(credentials) : authApi.login(credentials));
        } catch (error) {
            // Only the kind of attempt and the answer code: never the e-mail or the password.
            logger.warn('auth_failed', { mode, status: error.status });
            throw error;
        }
        if (result.needsConfirmation) {
            setNotice('Проверьте почту: мы отправили ссылку для подтверждения email. После подтверждения войдите.');
            return;
        }
        trackEvent(mode === 'register' ? 'sign_up' : 'login', { method: 'email' });
        setNotice('');
        setUser(result);
    }, []);

    /** Leaves for Google; the session is picked up by the effect above when the browser comes back. */
    const signInWithGoogle = useCallback(() => authApi.loginWithGoogle(), []);

    const signOut = useCallback(async () => {
        signingOut.current = true;
        try {
            await authApi.logout().catch(() => {});
        } finally {
            signingOut.current = false;
        }
        setNotice('');
        setUser(null);
    }, []);

    const value = useMemo(
        () => ({ user, checking, notice, signIn, signInWithGoogle, signOut }),
        [user, checking, notice, signIn, signInWithGoogle, signOut],
    );
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}

export const ROLE_LABELS = { pending: 'Ожидает подтверждения', storekeeper: 'Кладовщик', manager: 'Руководитель' };
