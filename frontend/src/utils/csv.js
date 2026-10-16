// CSV of overdue returns, built in the browser (it used to be built by the Node API).
// Excel-friendly: BOM, ';' separator, CRLF; cells that look like formulas get an apostrophe prefix.
import { daysOverdue, todayIso } from './format.js';

/** Escape a CSV cell. */
export function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = ['Инв. номер', 'Инструмент', 'Сотрудник', 'Подразделение', 'Выдан', 'Срок возврата', 'Дней просрочки'];

/** @param {object[]} issues rows of v_issues (overdue ones) */
export function buildOverdueCsv(issues, today = todayIso()) {
    const rows = issues.map((i) => [
        i.inv_number, i.tool_name, i.employee_name, i.department, i.issued_at, i.due_at, daysOverdue(i.due_at, today),
    ]);
    return `﻿${[HEADER, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** Offer a text as a file download. */
export function downloadText(filename, content, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
