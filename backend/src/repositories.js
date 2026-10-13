'use strict';
// Data access: one class per table. Every query is parameterized ($1, $2, ...).
const { HttpError } = require('./errors');
const { text, date, id, likePattern } = require('./validation');

const STATUSES = ['in_stock', 'issued', 'repair', 'written_off'];
const isUnique = (err) => err && err.code === '23505';

class CategoryRepository {
    constructor(d) { this.d = d; }

    list() {
        return this.d.all(`
            SELECT c.id, c.name, COUNT(t.id) AS tools_count
            FROM categories c LEFT JOIN tools t ON t.category_id = c.id
            GROUP BY c.id ORDER BY c.name`);
    }

    async get(categoryId) {
        const row = await this.d.get('SELECT id, name FROM categories WHERE id = $1', categoryId);
        if (!row) throw new HttpError(404, 'Категория не найдена');
        return row;
    }

    async create(body) {
        const name = text(body.name, 'Название', { required: true, max: 80 });
        try {
            const row = await this.d.get('INSERT INTO categories(name) VALUES ($1) RETURNING id', name);
            return this.get(row.id);
        } catch (err) {
            if (isUnique(err)) throw new HttpError(409, 'Категория с таким названием уже существует');
            throw err;
        }
    }

    async update(categoryId, body) {
        await this.get(categoryId);
        const name = text(body.name, 'Название', { required: true, max: 80 });
        try {
            await this.d.run('UPDATE categories SET name = $1 WHERE id = $2', name, categoryId);
            return this.get(categoryId);
        } catch (err) {
            if (isUnique(err)) throw new HttpError(409, 'Категория с таким названием уже существует');
            throw err;
        }
    }

    async remove(categoryId) {
        await this.get(categoryId);
        const used = (await this.d.get('SELECT COUNT(*) AS n FROM tools WHERE category_id = $1', categoryId)).n;
        if (used > 0) throw new HttpError(409, 'Нельзя удалить категорию, в которой есть инструменты');
        await this.d.run('DELETE FROM categories WHERE id = $1', categoryId);
    }
}

class ToolRepository {
    constructor(d) { this.d = d; }

    static SELECT = `
        SELECT t.id, t.inv_number, t.name, t.category_id, c.name AS category,
               t.manufacturer, t.purchase_date, t.price, t.status, t.location, t.note
        FROM tools t JOIN categories c ON c.id = t.category_id`;

    list({ q, category, status } = {}) {
        const where = []; const params = [];
        const bind = (v) => { params.push(v); return `$${params.length}`; };
        if (q) {
            const p = bind(likePattern(q));
            where.push(`(t.name ILIKE ${p} OR t.inv_number ILIKE ${p} OR t.manufacturer ILIKE ${p})`);
        }
        if (category) where.push(`t.category_id = ${bind(id(category, 'Категория'))}`);
        if (status) {
            if (!STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
            where.push(`t.status = ${bind(status)}`);
        }
        const sql = `${ToolRepository.SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY t.inv_number`;
        return this.d.all(sql, ...params);
    }

    async get(toolId) {
        const row = await this.d.get(`${ToolRepository.SELECT} WHERE t.id = $1`, toolId);
        if (!row) throw new HttpError(404, 'Инструмент не найден');
        return row;
    }

    static parse(body) {
        const raw = body.price;
        let price = 0;
        if (typeof raw === 'number') price = raw;
        else if (typeof raw === 'string' && raw.trim() !== '') {
            if (!/^\d+([.,]\d{1,2})?$/.test(raw.trim())) throw new HttpError(400, 'Цена должна быть неотрицательным числом');
            price = Number(raw.trim().replace(',', '.'));
        } else if (raw !== undefined && raw !== null && raw !== '') {
            throw new HttpError(400, 'Цена должна быть неотрицательным числом');
        }
        if (!Number.isFinite(price) || price < 0 || price > 9999999999) {
            throw new HttpError(400, 'Цена должна быть неотрицательным числом');
        }
        return {
            inv_number: text(body.inv_number, 'Инвентарный номер', { required: true, max: 30 }),
            name: text(body.name, 'Наименование', { required: true, max: 120 }),
            category_id: id(body.category_id, 'Категория'),
            manufacturer: text(body.manufacturer, 'Производитель', { max: 80 }),
            purchase_date: date(body.purchase_date, 'Дата покупки'),
            price,
            location: text(body.location, 'Место хранения', { max: 120 }),
            note: text(body.note, 'Примечание', { max: 300 }),
        };
    }

    async create(body) {
        const t = ToolRepository.parse(body);
        await new CategoryRepository(this.d).get(t.category_id);
        try {
            const row = await this.d.get(
                `INSERT INTO tools(inv_number,name,category_id,manufacturer,purchase_date,price,location,note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                t.inv_number, t.name, t.category_id, t.manufacturer, t.purchase_date, t.price, t.location, t.note);
            return this.get(row.id);
        } catch (err) {
            if (isUnique(err)) throw new HttpError(409, 'Инструмент с таким инвентарным номером уже есть');
            throw err;
        }
    }

    /**
     * Must run inside a transaction (see app.js): the row is locked so a concurrent issue/return
     * cannot change the status between our read and write.
     * @param {{role: string}} user write-off (and coming back from it) is for managers only
     */
    async update(toolId, body, user) {
        const current = await this.d.get(`${ToolRepository.SELECT} WHERE t.id = $1 FOR UPDATE OF t`, toolId);
        if (!current) throw new HttpError(404, 'Инструмент не найден');
        const t = ToolRepository.parse(body);
        await new CategoryRepository(this.d).get(t.category_id);
        let status = current.status;
        if (body.status !== undefined && body.status !== current.status) {
            status = body.status;
            if (!STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
            if (current.status === 'issued' || status === 'issued') {
                throw new HttpError(409, 'Статус «Выдан» меняется только через выдачу и возврат инструмента');
            }
            if ((status === 'written_off' || current.status === 'written_off') && user.role !== 'manager') {
                throw new HttpError(403, 'Недостаточно прав');
            }
        }
        try {
            await this.d.run(
                `UPDATE tools SET inv_number=$1, name=$2, category_id=$3, manufacturer=$4, purchase_date=$5,
                        price=$6, location=$7, note=$8, status=$9 WHERE id=$10`,
                t.inv_number, t.name, t.category_id, t.manufacturer, t.purchase_date, t.price, t.location, t.note, status, toolId);
            return this.get(toolId);
        } catch (err) {
            if (isUnique(err)) throw new HttpError(409, 'Инструмент с таким инвентарным номером уже есть');
            throw err;
        }
    }

    async remove(toolId) {
        await this.get(toolId);
        const n = (await this.d.get('SELECT COUNT(*) AS n FROM issues WHERE tool_id = $1', toolId)).n;
        if (n > 0) throw new HttpError(409, 'Нельзя удалить инструмент с историей выдач; спишите его (статус «Списан»)');
        await this.d.run('DELETE FROM tools WHERE id = $1', toolId);
    }
}

class EmployeeRepository {
    constructor(d) { this.d = d; }

    list({ q } = {}) {
        return this.d.all(`
            SELECT e.id, e.full_name, e.position, e.department, e.phone,
                   (SELECT COUNT(*) FROM issues i WHERE i.employee_id = e.id AND i.returned_at IS NULL) AS active_issues
            FROM employees e
            WHERE e.full_name ILIKE $1 OR e.department ILIKE $1
            ORDER BY e.full_name`, likePattern(q || ''));
    }

    async get(employeeId) {
        const row = await this.d.get('SELECT id, full_name, position, department, phone FROM employees WHERE id = $1', employeeId);
        if (!row) throw new HttpError(404, 'Сотрудник не найден');
        return row;
    }

    static parse(body) {
        return {
            full_name: text(body.full_name, 'ФИО', { required: true, max: 120 }),
            position: text(body.position, 'Должность', { max: 80 }),
            department: text(body.department, 'Подразделение', { max: 80 }),
            phone: text(body.phone, 'Телефон', { max: 30 }),
        };
    }

    async create(body) {
        const e = EmployeeRepository.parse(body);
        const row = await this.d.get(
            'INSERT INTO employees(full_name,position,department,phone) VALUES ($1,$2,$3,$4) RETURNING id',
            e.full_name, e.position, e.department, e.phone);
        return this.get(row.id);
    }

    async update(employeeId, body) {
        await this.get(employeeId);
        const e = EmployeeRepository.parse(body);
        await this.d.run('UPDATE employees SET full_name=$1, position=$2, department=$3, phone=$4 WHERE id=$5',
            e.full_name, e.position, e.department, e.phone, employeeId);
        return this.get(employeeId);
    }

    async remove(employeeId) {
        await this.get(employeeId);
        const n = (await this.d.get('SELECT COUNT(*) AS n FROM issues WHERE employee_id = $1', employeeId)).n;
        if (n > 0) throw new HttpError(409, 'Нельзя удалить сотрудника, за которым числятся выдачи (в том числе закрытые)');
        await this.d.run('DELETE FROM employees WHERE id = $1', employeeId);
    }
}

class IssueRepository {
    constructor(d) { this.d = d; }

    static SELECT = `
        SELECT i.id, i.tool_id, t.inv_number, t.name AS tool_name,
               i.employee_id, e.full_name AS employee_name, e.department,
               i.issued_at, i.due_at, i.returned_at, i.condition_note,
               u.login AS issued_by,
               CASE WHEN i.returned_at IS NULL AND i.due_at < CURRENT_DATE THEN 1 ELSE 0 END AS overdue
        FROM issues i
        JOIN tools t ON t.id = i.tool_id
        JOIN employees e ON e.id = i.employee_id
        LEFT JOIN users u ON u.id = i.issued_by`;

    list({ active, overdue, employee, tool } = {}) {
        const where = []; const params = [];
        const bind = (v) => { params.push(v); return `$${params.length}`; };
        if (active === '1') where.push('i.returned_at IS NULL');
        if (overdue === '1') where.push('i.returned_at IS NULL AND i.due_at < CURRENT_DATE');
        if (employee) where.push(`i.employee_id = ${bind(id(employee, 'Сотрудник'))}`);
        if (tool) where.push(`i.tool_id = ${bind(id(tool, 'Инструмент'))}`);
        const sql = `${IssueRepository.SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issued_at DESC, i.id DESC`;
        return this.d.all(sql, ...params);
    }

    async get(issueId) {
        const row = await this.d.get(`${IssueRepository.SELECT} WHERE i.id = $1`, issueId);
        if (!row) throw new HttpError(404, 'Запись о выдаче не найдена');
        return row;
    }
}

module.exports = { STATUSES, CategoryRepository, ToolRepository, EmployeeRepository, IssueRepository };
