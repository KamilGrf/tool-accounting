import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useSubmit } from '../hooks/useAsync.js';
import { Button, Field, inputClass } from '../components/ui.jsx';

/** Sign-in and registration on one screen. Server messages are shown as-is (ERR-AUTH-04/05). */
export default function LoginPage() {
    const { signIn, notice } = useAuth();
    const [mode, setMode] = useState('login');
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState({});
    const submit = useSubmit(() => signIn(mode, { login: login.trim(), password }));

    const onSubmit = async (e) => {
        e.preventDefault();
        submit.setError(''); // drop the previous server message before a new attempt
        const next = {};
        if (!login.trim()) next.login = 'Поле «Логин» обязательно для заполнения';
        if (!password) next.password = 'Поле «Пароль» обязательно для заполнения';
        else if (mode === 'register' && password.length < 8) next.password = 'Пароль должен быть не короче 8 символов';
        setErrors(next);
        if (Object.keys(next).length) return;
        const ok = await submit.run();
        if (!ok) setPassword(''); // keep the login, clear the password
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-4">
            <form onSubmit={onSubmit} noValidate className="w-full max-w-sm rounded-lg bg-white p-5 shadow">
                <h1 className="mb-1 text-lg font-semibold">АС «Учёт инструментов»</h1>
                <p className="mb-4 text-sm text-slate-500">{mode === 'login' ? 'Вход в систему' : 'Регистрация кладовщика'}</p>
                {notice && <p role="status" className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}

                <Field label="Логин" error={errors.login}>
                    {(p) => <input {...p} autoComplete="username" className={inputClass} value={login} onChange={(e) => setLogin(e.target.value)} />}
                </Field>
                <Field label="Пароль" error={errors.password}>
                    {(p) => (
                        <input {...p} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
                    )}
                </Field>

                {submit.error && <p role="alert" className="mb-3 text-sm text-red-700">{submit.error}</p>}
                <Button type="submit" className="w-full" disabled={submit.pending}>
                    {submit.pending ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                </Button>
                <button
                    type="button" className="mt-3 w-full text-sm text-blue-700 underline"
                    onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrors({}); submit.setError(''); }}
                >
                    {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
                </button>
            </form>
        </div>
    );
}
