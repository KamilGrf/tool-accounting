'use strict';
// Business logic: issue / return / extend, statistics, reports.
const { HttpError } = require('./errors');
const { text, date, id } = require('./validation');
const { CategoryRepository, ToolRepository, EmployeeRepository, IssueRepository } = require('./repositories');

const todayLocal = async (d) => (await d.get('SELECT CURRENT_DATE::text AS today')).today;

class IssueService {
    constructor(db) { this.db = db; }

    /** Issue a tool to an employee (use case «Выдать инструмент»). */
    async issueTool(body, user) {
        const toolId = id(body.tool_id, 'Инструмент');
        const employeeId = id(body.employee_id, 'Сотрудник');
        const newId = await this.db.transaction(async (tx) => {
            const issuedAt = date(body.issued_at, 'Дата выдачи') || await todayLocal(tx);
            const dueAt = date(body.due_at, 'Срок возврата', { required: true });
            if (dueAt < issuedAt) throw new HttpError(400, 'Срок возврата не может быть раньше даты выдачи');

            // Lock the tool row so two concurrent issues of the same tool are serialized.
            const tool = await tx.get('SELECT id, status FROM tools WHERE id = $1 FOR UPDATE', toolId);
            if (!tool) throw new HttpError(404, 'Инструмент не найден');
            await new EmployeeRepository(tx).get(employeeId);
            if (tool.status !== 'in_stock') {
                const reasons = { issued: 'уже выдан', repair: 'находится в ремонте', written_off: 'списан' };
                throw new HttpError(409, `Инструмент нельзя выдать: он ${reasons[tool.status]}`);
            }
            const row = await tx.get(
                'INSERT INTO issues(tool_id, employee_id, issued_at, due_at, issued_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
                toolId, employeeId, issuedAt, dueAt, user.id);
            await tx.run("UPDATE tools SET status = 'issued' WHERE id = $1", toolId);
            return row.id;
        });
        return new IssueRepository(this.db).get(newId);
    }

    /** Take a tool back (use case «Принять возврат»). */
    async returnTool(issueId, body = {}, user) {
        const note = text(body.condition_note, 'Состояние при возврате', { max: 300 });
        const requestedDate = date(body.returned_at, 'Дата возврата');
        const toRepair = body.to_repair === true || body.to_repair === 'true';

        await this.db.transaction(async (tx) => {
            const issue = await tx.get('SELECT id, tool_id, issued_at, returned_at FROM issues WHERE id = $1 FOR UPDATE', issueId);
            if (!issue) throw new HttpError(404, 'Запись о выдаче не найдена');
            if (issue.returned_at) throw new HttpError(409, 'Инструмент уже возвращён');
            const returnedAt = requestedDate || await todayLocal(tx);
            if (returnedAt < issue.issued_at) throw new HttpError(400, 'Дата возврата не может быть раньше даты выдачи');
            await tx.run('UPDATE issues SET returned_at = $1, condition_note = $2, returned_by = $3 WHERE id = $4',
                returnedAt, note, user.id, issueId);
            await tx.run('UPDATE tools SET status = $1, note = COALESCE($2, note) WHERE id = $3',
                toRepair ? 'repair' : 'in_stock', toRepair ? note : null, issue.tool_id);
        });
        return new IssueRepository(this.db).get(issueId);
    }

    /** Extend the due date of an open issue (use case «Продлить срок возврата»). */
    async extendIssue(issueId, body = {}) {
        const dueAt = date(body.due_at, 'Новый срок возврата', { required: true });
        await this.db.transaction(async (tx) => {
            const issue = await tx.get('SELECT id, due_at, returned_at FROM issues WHERE id = $1 FOR UPDATE', issueId);
            if (!issue) throw new HttpError(404, 'Запись о выдаче не найдена');
            if (issue.returned_at) throw new HttpError(409, 'Инструмент уже возвращён, срок продлить нельзя');
            if (dueAt <= issue.due_at) throw new HttpError(400, 'Новый срок возврата должен быть позже текущего');
            await tx.run('UPDATE issues SET due_at = $1 WHERE id = $2', dueAt, issueId);
        });
        return new IssueRepository(this.db).get(issueId);
    }

    /** Summary for the report (use case «Просмотреть отчёт»). */
    async stats() {
        const d = this.db;
        const byStatus = await d.all('SELECT status, COUNT(*) AS n FROM tools GROUP BY status');
        const counts = { in_stock: 0, issued: 0, repair: 0, written_off: 0 };
        byStatus.forEach((r) => { counts[r.status] = r.n; });
        const overdue = (await d.get('SELECT COUNT(*) AS n FROM issues WHERE returned_at IS NULL AND due_at < CURRENT_DATE')).n;
        const total = await d.get("SELECT COUNT(*) AS n, COALESCE(SUM(price),0) AS cost FROM tools WHERE status <> 'written_off'");
        const byCategory = await d.all(`
            SELECT c.name, COUNT(t.id) AS n, COALESCE(SUM(t.price),0) AS cost
            FROM categories c LEFT JOIN tools t ON t.category_id = c.id AND t.status <> 'written_off'
            GROUP BY c.id ORDER BY c.name`);
        const topEmployees = await d.all(`
            SELECT e.full_name, COUNT(*) AS n
            FROM issues i JOIN employees e ON e.id = i.employee_id
            WHERE i.returned_at IS NULL GROUP BY e.id ORDER BY n DESC, e.full_name LIMIT 5`);
        return { counts, overdue, total_tools: total.n, total_cost: total.cost, byCategory, topEmployees };
    }

    /** Usage per tool: number of issues and total days "on hand" (use case «Отчёт об использовании»). */
    async usageReport({ category } = {}) {
        const params = [];
        let where = "t.status <> 'written_off'";
        if (category) {
            const categoryId = id(category, 'Категория');
            await new CategoryRepository(this.db).get(categoryId);
            params.push(categoryId);
            where += ` AND t.category_id = $${params.length}`;
        }
        return this.db.all(`
            SELECT t.id AS tool_id, t.inv_number, t.name AS tool_name, c.name AS category,
                   COUNT(i.id) AS issues_count,
                   COALESCE(SUM(COALESCE(i.returned_at, CURRENT_DATE) - i.issued_at), 0) AS days_in_use,
                   MAX(i.issued_at) AS last_issued_at
            FROM tools t
            JOIN categories c ON c.id = t.category_id
            LEFT JOIN issues i ON i.tool_id = t.id
            WHERE ${where}
            GROUP BY t.id, c.name
            ORDER BY days_in_use DESC, t.inv_number`, ...params);
    }

    /** CSV of overdue returns (Excel-friendly: BOM, ';' separator, formula-injection guard). */
    async overdueCsv() {
        const rows = (await new IssueRepository(this.db).list({ overdue: '1' })).map((i) => [
            i.inv_number, i.tool_name, i.employee_name, i.department, i.issued_at, i.due_at, null,
        ]);
        const today = Date.parse(await todayLocal(this.db));
        rows.forEach((r) => { r[6] = Math.round((today - Date.parse(r[5])) / 86400000); });
        const header = ['Инв. номер', 'Инструмент', 'Сотрудник', 'Подразделение', 'Выдан', 'Срок возврата', 'Дней просрочки'];
        return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
    }
}

/** Escape a CSV cell; strings that look like formulas get an apostrophe prefix. */
function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { IssueService, ToolRepository, csvCell };
