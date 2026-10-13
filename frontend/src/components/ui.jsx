// Small presentational building blocks shared by all pages.
import { useEffect, useId } from 'react';
import { STATUS_LABELS } from '../utils/format.js';

const STATUS_STYLES = {
    in_stock: 'border-teal-700 text-teal-800 bg-teal-50',
    issued: 'border-amber-700 text-amber-800 bg-amber-50',
    repair: 'border-red-700 text-red-800 bg-red-50',
    written_off: 'border-slate-500 text-slate-700 bg-slate-100',
};

/** Status is always conveyed by text, never by colour alone (NFR-04). */
export function StatusBadge({ status }) {
    return (
        <span className={`inline-block whitespace-nowrap rounded-sm border px-2 text-xs ${STATUS_STYLES[status] || ''}`}>
            {STATUS_LABELS[status] || status}
        </span>
    );
}

export function Button({ variant = 'primary', className = '', ...props }) {
    const styles = {
        primary: 'bg-blue-700 text-white border-blue-700 hover:bg-blue-800',
        secondary: 'bg-white text-blue-700 border-blue-700 hover:bg-blue-50',
    };
    return (
        <button
            type="button"
            className={`rounded border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
            {...props}
        />
    );
}

export function Spinner({ label = 'Загрузка…' }) {
    return <div role="status" className="py-8 text-center text-slate-500">{label}</div>;
}

/** Error banner with retry; used for network and server errors (ERR-NET-*). */
export function ErrorBanner({ error, onRetry }) {
    if (!error) return null;
    return (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span>{error.name === 'NetworkError' ? 'Не удалось загрузить данные. Проверьте соединение' : error.message}</span>
            {onRetry && <Button variant="secondary" onClick={onRetry}>Повторить</Button>}
        </div>
    );
}

/** Scrollable bordered wrapper: wide tables scroll inside it instead of the whole page (NFR-03). */
export function TableCard({ children }) {
    return <div className="overflow-x-auto rounded border border-slate-300 bg-white">{children}</div>;
}

export function EmptyState({ children }) {
    return <div className="py-8 text-center text-slate-500">{children}</div>;
}

export function Field({ label, error, children }) {
    const id = useId();
    const child = children({ id, 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': error ? `${id}-err` : undefined });
    return (
        <div className="mb-3">
            <label htmlFor={id} className="mb-1 block text-sm text-slate-600">{label}</label>
            {child}
            {error && <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
        </div>
    );
}

export const inputClass = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm aria-[invalid=true]:border-red-600';

/** Modal dialog; closes on Escape and on backdrop click. */
export function Modal({ title, onClose, children }) {
    const titleId = useId();
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-full w-full overflow-auto rounded-t-lg bg-white p-4 shadow-lg sm:max-w-md sm:rounded-lg">
                <h2 id={titleId} className="mb-3 text-base font-semibold">{title}</h2>
                {children}
            </div>
        </div>
    );
}

/** Footer with submit/cancel buttons and a form-level error (ERR-VAL-*, ERR-CONF-*). */
export function FormFooter({ pending, error, onCancel, submitLabel }) {
    return (
        <>
            {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onCancel}>Отмена</Button>
                <Button type="submit" disabled={pending}>{pending ? 'Подождите…' : submitLabel}</Button>
            </div>
        </>
    );
}
