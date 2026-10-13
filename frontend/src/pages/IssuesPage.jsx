import { useState } from 'react';
import { issuesApi } from '../api/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { daysOverdue, formatDate } from '../utils/format.js';
import { ReturnForm } from '../components/forms.jsx';
import { Button, EmptyState, ErrorBanner, Spinner, TableCard } from '../components/ui.jsx';

const FILTERS = [
    { key: 'active', label: 'Активные', params: { active: 1 } },
    { key: 'overdue', label: 'Просроченные', params: { overdue: 1 } },
    { key: 'all', label: 'Все', params: {} },
];

export default function IssuesPage() {
    const [filter, setFilter] = useState('active');
    const [returning, setReturning] = useState(null);
    const params = FILTERS.find((f) => f.key === filter).params;
    const issues = useAsync(() => issuesApi.list(params), [filter]);

    return (
        <div>
            <h2 className="mb-3 text-lg font-semibold">Выдача и возврат</h2>
            <div role="group" aria-label="Фильтр выдач" className="mb-3 flex gap-2">
                {FILTERS.map((f) => (
                    <Button key={f.key} variant={filter === f.key ? 'primary' : 'secondary'} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                        {f.label}
                    </Button>
                ))}
            </div>

            <ErrorBanner error={issues.error} onRetry={issues.reload} />
            {issues.loading && !issues.data && <Spinner />}
            {issues.data && issues.data.length === 0 && (
                <EmptyState>{filter === 'overdue' ? 'Просроченных возвратов нет' : 'Выдач нет'}</EmptyState>
            )}
            {issues.data && issues.data.length > 0 && (
                <TableCard>
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-slate-200 text-left">
                            <tr>
                                <th className="px-2.5 py-2">Инструмент</th>
                                <th className="px-2.5 py-2">Сотрудник</th>
                                <th className="hidden px-2.5 py-2 sm:table-cell">Выдан</th>
                                <th className="px-2.5 py-2">Срок</th>
                                <th className="px-2.5 py-2"><span className="sr-only">Действия</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {issues.data.map((i) => {
                                const late = !i.returned_at && i.overdue;
                                return (
                                    <tr key={i.id} className="border-t border-slate-200">
                                        <td className="px-2.5 py-2">{i.inv_number} — {i.tool_name}</td>
                                        <td className="px-2.5 py-2">{i.employee_name}</td>
                                        <td className="hidden px-2.5 py-2 sm:table-cell">{formatDate(i.issued_at)}</td>
                                        <td className={`px-2.5 py-2 ${late ? 'font-semibold text-red-700' : ''}`}>
                                            {i.returned_at ? `Возвращён ${formatDate(i.returned_at)}` : formatDate(i.due_at)}
                                            {late && <> (−{daysOverdue(i.due_at)} дн.)</>}
                                        </td>
                                        <td className="px-2.5 py-2 text-right">
                                            {!i.returned_at && <Button variant="secondary" onClick={() => setReturning(i)}>Принять</Button>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </TableCard>
            )}
            {returning && <ReturnForm issue={returning} onSaved={issues.reload} onClose={() => setReturning(null)} />}
        </div>
    );
}
