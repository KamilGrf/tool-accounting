import { useState } from 'react';
import { usersApi } from '../api/index.js';
import { trackEvent } from '../analytics.js';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, ErrorBanner, Spinner, TableCard } from '../components/ui.jsx';
import { formatDate } from '../utils/format.js';

const ACTIONS = [
    { role: 'storekeeper', label: 'Кладовщик' },
    { role: 'manager', label: 'Руководитель' },
    { role: 'pending', label: 'Закрыть доступ' },
];

/** Managers approve new accounts and change roles. The database refuses anybody else and a change of one's own role. */
export default function UsersPage() {
    const { user } = useAuth();
    const users = useAsync(() => usersApi.list(), []);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);

    const change = async (target, role) => {
        if (
            role === 'manager' &&
            !window.confirm(`Дать пользователю ${target.email} права руководителя? Он сможет подтверждать доступ других людей.`)
        )
            return;
        setBusy(target.id);
        setError(null);
        try {
            await usersApi.setRole(target.id, role);
            trackEvent('user_role_changed', { role });
            users.reload();
        } catch (e) {
            setError(e);
        } finally {
            setBusy(null);
        }
    };

    const pending = (users.data || []).filter((u) => u.role === 'pending').length;

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold">Пользователи</h2>
            <p className="mb-3 text-sm text-slate-600">
                Новые аккаунты не видят данные, пока вы не подтвердите их{pending > 0 && <strong> (ожидают: {pending})</strong>}.
            </p>
            <ErrorBanner error={error} />
            <ErrorBanner error={users.error} onRetry={users.reload} />
            {users.loading && !users.data && <Spinner />}
            {users.data && users.data.length === 0 && <EmptyState>Пользователей нет</EmptyState>}
            {users.data && users.data.length > 0 && (
                <TableCard>
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-slate-200 text-left">
                            <tr>
                                <th className="px-2.5 py-2">Email</th>
                                <th className="px-2.5 py-2">Роль</th>
                                <th className="hidden px-2.5 py-2 sm:table-cell">Регистрация</th>
                                <th className="px-2.5 py-2">Назначить</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.data.map((u) => (
                                <tr key={u.id} className={`border-t border-slate-200 ${u.role === 'pending' ? 'bg-amber-50' : ''}`}>
                                    <td className="px-2.5 py-2">{u.email}</td>
                                    <td className="px-2.5 py-2">{ROLE_LABELS[u.role] || u.role}</td>
                                    <td className="hidden px-2.5 py-2 sm:table-cell">{formatDate(u.created_at?.slice(0, 10))}</td>
                                    <td className="px-2.5 py-2">
                                        {u.id === user.id ? (
                                            <span className="text-slate-500">это вы</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                                {ACTIONS.filter((a) => a.role !== u.role).map((a) => (
                                                    <Button
                                                        key={a.role}
                                                        variant="secondary"
                                                        disabled={busy === u.id}
                                                        aria-label={`${a.label}: ${u.email}`}
                                                        onClick={() => change(u, a.role)}
                                                    >
                                                        {a.label}
                                                    </Button>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableCard>
            )}
        </div>
    );
}
