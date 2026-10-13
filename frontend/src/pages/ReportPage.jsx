import { issuesApi, statsApi, OVERDUE_CSV_URL } from '../api/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { daysOverdue, formatDate, formatMoney } from '../utils/format.js';
import { EmptyState, ErrorBanner, Spinner, TableCard } from '../components/ui.jsx';

function Tile({ value, label, alert }) {
    return (
        <div className={`rounded-lg p-4 shadow ${alert ? 'bg-red-600 text-white' : 'bg-white'}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className={`text-sm ${alert ? 'text-white' : 'text-slate-500'}`}>{label}</div>
        </div>
    );
}

export default function ReportPage() {
    const report = useAsync(async () => {
        const [stats, overdue, usage] = await Promise.all([statsApi.get(), issuesApi.list({ overdue: 1 }), statsApi.usage()]);
        return { stats, overdue, usage };
    }, []);

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Отчёт по инструментам</h2>
                <a href={OVERDUE_CSV_URL} download="overdue.csv" className="rounded border border-blue-700 bg-white px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50">
                    Экспорт CSV
                </a>
            </div>
            <ErrorBanner error={report.error} onRetry={report.reload} />
            {report.loading && !report.data && <Spinner />}
            {report.data && <ReportBody {...report.data} />}
        </div>
    );
}

function ReportBody({ stats, overdue, usage }) {
    if (stats.total_tools === 0) return <EmptyState>Данных пока нет</EmptyState>;
    return (
        <>
            <section aria-label="Сводка" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <Tile value={stats.total_tools} label="Инструментов в учёте" />
                <Tile value={formatMoney(stats.total_cost)} label="Стоимость парка" />
                <Tile value={stats.counts.in_stock} label="На складе" />
                <Tile value={stats.counts.issued} label="Выдано" />
                <Tile value={stats.counts.repair} label="В ремонте" />
                <Tile value={stats.overdue} label="Просрочено возвратов" alert={stats.overdue > 0} />
            </section>

            <div className="mb-5 grid gap-4 md:grid-cols-2">
                <section>
                    <h3 className="mb-1 font-semibold">По категориям</h3>
                    <TableCard>
                        <table className="w-full text-sm">
                            <thead className="bg-slate-200 text-left"><tr><th className="px-2.5 py-2">Категория</th><th className="px-2.5 py-2 text-right">Шт.</th><th className="px-2.5 py-2 text-right">Стоимость</th></tr></thead>
                            <tbody>
                                {stats.byCategory.map((c) => (
                                    <tr key={c.name} className="border-t border-slate-200">
                                        <td className="px-2.5 py-2">{c.name}</td>
                                        <td className="px-2.5 py-2 text-right">{c.n}</td>
                                        <td className="px-2.5 py-2 text-right">{formatMoney(c.cost)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableCard>
                </section>
                <section>
                    <h3 className="mb-1 font-semibold">Больше всего инструментов на руках</h3>
                    {stats.topEmployees.length === 0 ? (
                        <p className="text-sm text-slate-500">Нет невозвращённых инструментов</p>
                    ) : (
                        <TableCard>
                            <table className="w-full text-sm">
                                <thead className="bg-slate-200 text-left"><tr><th className="px-2.5 py-2">Сотрудник</th><th className="px-2.5 py-2 text-right">Шт.</th></tr></thead>
                                <tbody>
                                    {stats.topEmployees.map((e) => (
                                        <tr key={e.full_name} className="border-t border-slate-200"><td className="px-2.5 py-2">{e.full_name}</td><td className="px-2.5 py-2 text-right">{e.n}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableCard>
                    )}
                </section>
            </div>

            <section className="mb-5">
                <h3 className="mb-1 font-semibold">Использование инструментов</h3>
                <TableCard>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-200 text-left"><tr><th className="px-2.5 py-2">Инструмент</th><th className="px-2.5 py-2 text-right">Выдач</th><th className="px-2.5 py-2 text-right">Дней на руках</th><th className="hidden px-2.5 py-2 sm:table-cell">Последняя выдача</th></tr></thead>
                        <tbody>
                            {usage.map((u) => (
                                <tr key={u.tool_id} className="border-t border-slate-200">
                                    <td className="px-2.5 py-2">{u.inv_number} — {u.tool_name}</td>
                                    <td className="px-2.5 py-2 text-right">{u.issues_count}</td>
                                    <td className="px-2.5 py-2 text-right">{u.days_in_use}</td>
                                    <td className="hidden px-2.5 py-2 sm:table-cell">{formatDate(u.last_issued_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableCard>
            </section>

            <section>
                <h3 className="mb-1 font-semibold">Просроченные возвраты</h3>
                {overdue.length === 0 ? (
                    <p className="text-sm text-slate-500">Просроченных возвратов нет</p>
                ) : (
                    <TableCard>
                        <table className="w-full text-sm">
                            <thead className="bg-slate-200 text-left"><tr><th className="px-2.5 py-2">Инструмент</th><th className="px-2.5 py-2">Сотрудник</th><th className="px-2.5 py-2">Вернуть до</th><th className="px-2.5 py-2 text-right">Дней</th></tr></thead>
                            <tbody>
                                {overdue.map((i) => (
                                    <tr key={i.id} className="border-t border-slate-200 text-red-800">
                                        <td className="px-2.5 py-2">{i.inv_number} — {i.tool_name}</td>
                                        <td className="px-2.5 py-2">{i.employee_name}</td>
                                        <td className="px-2.5 py-2">{formatDate(i.due_at)}</td>
                                        <td className="px-2.5 py-2 text-right font-semibold">{daysOverdue(i.due_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableCard>
                )}
            </section>
        </>
    );
}
