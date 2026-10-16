import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from '../components/ui.jsx';

/** What a newly registered user sees until a manager approves the account: no data, no menu. */
export default function PendingPage() {
    const { user, signOut } = useAuth();
    return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow">
                <h1 className="mb-1 text-lg font-semibold">Доступ ожидает подтверждения</h1>
                <p className="mb-4 text-sm text-slate-600">
                    Аккаунт <strong data-testid="pending-login">{user.login}</strong> создан. Руководитель должен подтвердить его, и только
                    после этого откроются данные системы. Попросите руководителя одобрить доступ и обновите страницу.
                </p>
                <div className="flex items-center justify-between gap-3">
                    <Button onClick={() => window.location.reload()}>Обновить</Button>
                    <button type="button" onClick={signOut} className="text-sm text-blue-700 underline">
                        Выйти
                    </button>
                </div>
                <p className="mt-4 text-center text-xs text-slate-500">
                    <Link to="/privacy" className="underline">
                        Политика конфиденциальности
                    </Link>
                </p>
            </div>
        </div>
    );
}
