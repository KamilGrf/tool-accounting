// Session state for the whole app: who is signed in, and what happens when the session ends.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/index.js';
import { AUTH_EXPIRED } from '../api/client.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(true);
    const [notice, setNotice] = useState('');

    // On start ask the server who we are (the session lives in an HttpOnly cookie we cannot read).
    useEffect(() => {
        let alive = true;
        authApi.me().then((u) => alive && setUser(u), () => {}).finally(() => alive && setChecking(false));
        return () => { alive = false; };
    }, []);

    // Any 401 from the API means the session is gone.
    useEffect(() => {
        const onExpired = () => {
            setUser((current) => {
                if (current) setNotice('Сессия истекла. Войдите снова');
                return null;
            });
        };
        window.addEventListener(AUTH_EXPIRED, onExpired);
        return () => window.removeEventListener(AUTH_EXPIRED, onExpired);
    }, []);

    const signIn = useCallback(async (mode, credentials) => {
        const u = await (mode === 'register' ? authApi.register(credentials) : authApi.login(credentials));
        setNotice('');
        setUser(u);
    }, []);

    const signOut = useCallback(async () => {
        await authApi.logout().catch(() => {});
        setNotice('');
        setUser(null);
    }, []);

    const value = useMemo(() => ({ user, checking, notice, signIn, signOut }), [user, checking, notice, signIn, signOut]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}

export const ROLE_LABELS = { storekeeper: 'Кладовщик', manager: 'Руководитель' };
