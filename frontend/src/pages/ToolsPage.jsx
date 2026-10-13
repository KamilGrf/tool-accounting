// Tools catalogue: filters + table + details panel (master-detail, concept 3).
import { useEffect, useRef, useState } from 'react';
import { categoriesApi, issuesApi, toolsApi } from '../api/index.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { daysOverdue, formatDate, formatMoney } from '../utils/format.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ExtendForm, IssueForm, ReturnForm, ToolForm, WriteOffForm } from '../components/forms.jsx';
import { Button, EmptyState, ErrorBanner, Spinner, StatusBadge, TableCard } from '../components/ui.jsx';

const STATUS_OPTIONS = [
    ['', 'Все статусы'], ['in_stock', 'На складе'], ['issued', 'Выдан'], ['repair', 'В ремонте'], ['written_off', 'Списан'],
];

export default function ToolsPage() {
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [category, setCategory] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [modal, setModal] = useState(null); // 'add' | 'issue' | 'writeoff' | { returnIssue } | { extendIssue }
    const debouncedQ = useDebounced(q);
    const detailRef = useRef(null);

    const tools = useAsync(() => toolsApi.list({ q: debouncedQ, status, category }), [debouncedQ, status, category]);
    const categories = useAsync(() => categoriesApi.list(), []);
    const selected = (tools.data || []).find((t) => t.id === selectedId) || null;
    const hasFilters = Boolean(q || status || category);

    const resetFilters = () => { setQ(''); setStatus(''); setCategory(''); };
    const afterChange = () => tools.reload();

    // Below the xl breakpoint the details panel sits under the table, out of sight:
    // bring it into view once it has rendered the newly chosen tool.
    useEffect(() => {
        if (selectedId && window.matchMedia?.('(max-width: 1279px)').matches) {
            detailRef.current?.scrollIntoView?.({ block: 'start' });
        }
    }, [selectedId]);

    return (
        <div>
            <h2 className="mb-3 text-lg font-semibold">Инструменты</h2>
            <div className="mb-3 flex flex-wrap gap-2">
                <input
                    type="search" aria-label="Поиск" placeholder="Название, номер, производитель"
                    value={q} onChange={(e) => setQ(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm sm:max-w-xs"
                />
                <select aria-label="Категория" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
                    <option value="">Все категории</option>
                    {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
                    {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Button onClick={() => setModal('add')} disabled={!categories.data}>Добавить инструмент</Button>
            </div>

            <ErrorBanner error={tools.error} onRetry={tools.reload} />

            <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
                <section aria-label="Список инструментов" className="min-w-0">
                    {tools.loading && !tools.data && <Spinner />}
                    {tools.data && tools.data.length === 0 && (
                        <EmptyState>
                            {hasFilters ? (
                                <>Ничего не найдено <div className="mt-2"><Button variant="secondary" onClick={resetFilters}>Сбросить фильтры</Button></div></>
                            ) : 'Инструментов пока нет'}
                        </EmptyState>
                    )}
                    {tools.data && tools.data.length > 0 && (
                        <TableCard>
                            <table className="w-full border-collapse text-sm">
                                <thead className="bg-slate-200 text-left">
                                    <tr>
                                        <th className="px-2.5 py-2">Инв. №</th>
                                        <th className="px-2.5 py-2">Наименование</th>
                                        <th className="hidden px-2.5 py-2 md:table-cell">Категория</th>
                                        <th className="px-2.5 py-2">Статус</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tools.data.map((t) => (
                                        <tr
                                            key={t.id}
                                            tabIndex={0}
                                            aria-selected={t.id === selectedId}
                                            onClick={() => setSelectedId(t.id)}
                                            onKeyDown={(e) => e.key === 'Enter' && setSelectedId(t.id)}
                                            className={`cursor-pointer border-t border-slate-200 hover:bg-blue-50 ${t.id === selectedId ? 'bg-blue-100' : ''}`}
                                        >
                                            <td className="whitespace-nowrap px-2.5 py-2">{t.inv_number}</td>
                                            <td className="px-2.5 py-2">{t.name}</td>
                                            <td className="hidden px-2.5 py-2 md:table-cell">{t.category}</td>
                                            <td className="px-2.5 py-2"><StatusBadge status={t.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableCard>
                    )}
                </section>

                <aside ref={detailRef} aria-label="Карточка инструмента" className="scroll-mt-3 rounded border border-slate-300 bg-white p-4">
                    {selected ? (
                        <ToolDetail key={selected.id} tool={selected} version={tools.data} onIssue={() => setModal('issue')} onWriteOff={() => setModal('writeoff')} onReturn={(issue) => setModal({ returnIssue: issue })} onExtend={(issue) => setModal({ extendIssue: issue })} />
                    ) : (
                        <p className="text-sm text-slate-500">Выберите инструмент в списке</p>
                    )}
                </aside>
            </div>

            {modal === 'add' && <ToolForm categories={categories.data || []} onSaved={afterChange} onClose={() => setModal(null)} />}
            {modal === 'issue' && selected && <IssueForm tool={selected} onSaved={afterChange} onClose={() => setModal(null)} />}
            {modal === 'writeoff' && selected && <WriteOffForm tool={selected} onSaved={afterChange} onClose={() => setModal(null)} />}
            {modal?.extendIssue && <ExtendForm issue={modal.extendIssue} onSaved={afterChange} onClose={() => setModal(null)} />}
            {modal?.returnIssue && <ReturnForm issue={modal.returnIssue} onSaved={afterChange} onClose={() => setModal(null)} />}
        </div>
    );
}

function ToolDetail({ tool, onIssue, onReturn, onExtend, onWriteOff, version }) {
    const { user } = useAuth();
    // `version` changes after every list reload, so the history refreshes too.
    const history = useAsync(() => issuesApi.list({ tool: tool.id }), [tool.id, version]);
    const open = (history.data || []).find((i) => !i.returned_at);

    return (
        <div>
            <h3 className="font-semibold">{tool.name}</h3>
            <div className="mt-1"><StatusBadge status={tool.status} /></div>
            <dl className="my-3 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-slate-500">Инв. номер</dt><dd>{tool.inv_number}</dd>
                <dt className="text-slate-500">Категория</dt><dd>{tool.category}</dd>
                <dt className="text-slate-500">Производитель</dt><dd>{tool.manufacturer || '—'}</dd>
                <dt className="text-slate-500">Цена</dt><dd>{formatMoney(tool.price)}</dd>
                <dt className="text-slate-500">Хранение</dt><dd>{tool.location || '—'}</dd>
                {tool.note && <><dt className="text-slate-500">Примечание</dt><dd>{tool.note}</dd></>}
            </dl>

            <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">История выдач</h4>
            <ErrorBanner error={history.error} onRetry={history.reload} />
            {history.loading && !history.data && <Spinner />}
            {history.data && history.data.length === 0 && <p className="text-sm text-slate-500">Этот инструмент ещё не выдавался</p>}
            {history.data && history.data.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                    {history.data.map((i) => {
                        const late = !i.returned_at && i.overdue;
                        return (
                            <li key={i.id}>
                                {formatDate(i.issued_at)} — {i.employee_name}, до {formatDate(i.due_at)}
                                {i.returned_at && `, возврат ${formatDate(i.returned_at)}`}
                                {late && <span className="font-semibold text-red-700"> (просрочено на {daysOverdue(i.due_at)} дн.)</span>}
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
                {tool.status === 'in_stock' && <Button onClick={onIssue}>Выдать</Button>}
                {tool.status === 'issued' && open && <Button onClick={() => onReturn(open)}>Принять возврат</Button>}
                {tool.status === 'issued' && open && <Button variant="secondary" onClick={() => onExtend(open)}>Продлить срок</Button>}
                {user.role === 'manager' && ['in_stock', 'repair'].includes(tool.status) && <Button variant="secondary" onClick={onWriteOff}>Списать</Button>}
            </div>
        </div>
    );
}
