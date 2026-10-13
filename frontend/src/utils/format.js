export const STATUS_LABELS = {
    in_stock: 'На складе',
    issued: 'Выдан',
    repair: 'В ремонте',
    written_off: 'Списан',
};

/** "2026-10-13" -> "13.10.2026"; empty -> em dash. */
export function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
}

export function formatMoney(n) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0);
}

/** Local date as YYYY-MM-DD, shifted by `offsetDays` (never via toISOString: it is UTC). */
export function todayIso(offsetDays = 0, now = new Date()) {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days between a due date and today (positive = overdue). */
export function daysOverdue(dueIso, todayStr = todayIso()) {
    const ms = Date.parse(todayStr) - Date.parse(dueIso);
    return Math.round(ms / 86400000);
}
