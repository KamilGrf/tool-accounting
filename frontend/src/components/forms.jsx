// Modal forms: add tool, issue tool, return tool.
// Client-side checks only improve UX (ERR-VAL-01); the server remains the source of truth.
import { useState } from 'react';
import { toolsApi, issuesApi, employeesApi } from '../api/index.js';
import { useAsync, useSubmit } from '../hooks/useAsync.js';
import { formatDate, todayIso } from '../utils/format.js';
import { Field, FormFooter, Modal, inputClass } from './ui.jsx';

const required = (label) => `Поле «${label}» обязательно для заполнения`;

export function ToolForm({ categories, onSaved, onClose }) {
    const [values, setValues] = useState({ inv_number: '', name: '', category_id: '', manufacturer: '', price: '', location: '' });
    const [errors, setErrors] = useState({});
    const submit = useSubmit(async () => {
        await toolsApi.create(values);
        onSaved();
    });
    const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        const next = {};
        if (!values.inv_number.trim()) next.inv_number = required('Инвентарный номер');
        if (!values.name.trim()) next.name = required('Наименование');
        if (!values.category_id) next.category_id = required('Категория');
        setErrors(next);
        if (Object.keys(next).length) return;
        if (await submit.run()) onClose();
    };

    return (
        <Modal title="Добавить инструмент" onClose={onClose}>
            <form onSubmit={onSubmit} noValidate>
                <Field label="Инвентарный номер *" error={errors.inv_number}>
                    {(p) => <input {...p} className={inputClass} value={values.inv_number} onChange={set('inv_number')} />}
                </Field>
                <Field label="Наименование *" error={errors.name}>
                    {(p) => <input {...p} className={inputClass} value={values.name} onChange={set('name')} />}
                </Field>
                <Field label="Категория *" error={errors.category_id}>
                    {(p) => (
                        <select {...p} className={inputClass} value={values.category_id} onChange={set('category_id')}>
                            <option value="">Выберите категорию</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    )}
                </Field>
                <Field label="Производитель">
                    {(p) => <input {...p} className={inputClass} value={values.manufacturer} onChange={set('manufacturer')} />}
                </Field>
                <Field label="Цена, ₽">
                    {(p) => <input {...p} type="number" min="0" className={inputClass} value={values.price} onChange={set('price')} />}
                </Field>
                <Field label="Место хранения">
                    {(p) => <input {...p} className={inputClass} value={values.location} onChange={set('location')} />}
                </Field>
                <FormFooter pending={submit.pending} error={submit.error} onCancel={onClose} submitLabel="Сохранить" />
            </form>
        </Modal>
    );
}

export function IssueForm({ tool, onSaved, onClose }) {
    const employees = useAsync(() => employeesApi.list(), []);
    const [employeeId, setEmployeeId] = useState('');
    const [dueAt, setDueAt] = useState(todayIso(7));
    const [errors, setErrors] = useState({});
    const submit = useSubmit(async () => {
        await issuesApi.issue({ tool_id: tool.id, employee_id: Number(employeeId), due_at: dueAt });
        onSaved();
    });

    const onSubmit = async (e) => {
        e.preventDefault();
        const next = {};
        if (!employeeId) next.employee = required('Сотрудник');
        if (!dueAt) next.due = required('Срок возврата');
        else if (dueAt < todayIso()) next.due = 'Срок возврата не может быть раньше даты выдачи';
        setErrors(next);
        if (Object.keys(next).length) return;
        if (await submit.run()) onClose();
    };

    return (
        <Modal title={`Выдать: ${tool.name}`} onClose={onClose}>
            <form onSubmit={onSubmit} noValidate>
                <Field label="Сотрудник *" error={errors.employee}>
                    {(p) => (
                        <select {...p} className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={employees.loading && !employees.data}>
                            <option value="">{employees.loading ? 'Загрузка…' : 'Выберите сотрудника'}</option>
                            {(employees.data || []).map((e) => (
                                <option key={e.id} value={e.id}>{e.full_name}{e.department ? ` — ${e.department}` : ''}</option>
                            ))}
                        </select>
                    )}
                </Field>
                {employees.error && <p role="alert" className="mb-3 text-sm text-red-700">Не удалось загрузить сотрудников. Закройте форму и повторите</p>}
                <Field label="Вернуть до *" error={errors.due}>
                    {(p) => <input {...p} type="date" min={todayIso()} className={inputClass} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
                </Field>
                <FormFooter pending={submit.pending} error={submit.error} onCancel={onClose} submitLabel="Выдать" />
            </form>
        </Modal>
    );
}

export function ReturnForm({ issue, onSaved, onClose }) {
    const [note, setNote] = useState('');
    const [toRepair, setToRepair] = useState(false);
    const submit = useSubmit(async () => {
        await issuesApi.returnTool(issue.id, { condition_note: note, to_repair: toRepair });
        onSaved();
    });
    const onSubmit = async (e) => {
        e.preventDefault();
        if (await submit.run()) onClose();
    };
    return (
        <Modal title={`Принять возврат: ${issue.tool_name}`} onClose={onClose}>
            <form onSubmit={onSubmit} noValidate>
                <Field label="Состояние при возврате">
                    {(p) => <textarea {...p} rows={3} maxLength={300} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <label className="mb-3 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={toRepair} onChange={(e) => setToRepair(e.target.checked)} />
                    Отправить в ремонт
                </label>
                <FormFooter pending={submit.pending} error={submit.error} onCancel={onClose} submitLabel="Принять" />
            </form>
        </Modal>
    );
}

export function ExtendForm({ issue, onSaved, onClose }) {
    const [dueAt, setDueAt] = useState('');
    const [error, setError] = useState('');
    const submit = useSubmit(async () => {
        await issuesApi.extend(issue.id, { due_at: dueAt });
        onSaved();
    });
    const onSubmit = async (e) => {
        e.preventDefault();
        if (!dueAt) return setError(required('Новый срок возврата'));
        if (dueAt <= issue.due_at) return setError('Новый срок возврата должен быть позже текущего');
        setError('');
        if (await submit.run()) onClose();
    };
    return (
        <Modal title={`Продлить срок: ${issue.tool_name}`} onClose={onClose}>
            <form onSubmit={onSubmit} noValidate>
                <p className="mb-3 text-sm text-slate-600">Текущий срок: {formatDate(issue.due_at)}</p>
                <Field label="Новый срок возврата *" error={error}>
                    {(p) => <input {...p} type="date" className={inputClass} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
                </Field>
                <FormFooter pending={submit.pending} error={submit.error} onCancel={onClose} submitLabel="Продлить" />
            </form>
        </Modal>
    );
}

/** Write-off is irreversible for a storekeeper, so it asks for confirmation first (manager only). */
export function WriteOffForm({ tool, onSaved, onClose }) {
    const submit = useSubmit(async () => {
        await toolsApi.update(tool.id, { ...tool, status: 'written_off' });
        onSaved();
    });
    const onSubmit = async (e) => {
        e.preventDefault();
        if (await submit.run()) onClose();
    };
    return (
        <Modal title="Списать инструмент" onClose={onClose}>
            <form onSubmit={onSubmit}>
                <p className="mb-3 text-sm">Списать «{tool.name}» ({tool.inv_number})? Он исчезнет из отчётов и не сможет быть выдан.</p>
                <FormFooter pending={submit.pending} error={submit.error} onCancel={onClose} submitLabel="Списать" />
            </form>
        </Modal>
    );
}
