// Normalizes the "tool" form values before they are written: the same rules the old Node API applied
// (trim, empty -> null, price parsing). The database re-checks lengths with CHECK constraints.
import { ApiError } from '../api/client.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value, field, { required = false, max = 200 } = {}) {
    if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new ApiError(400, `Поле «${field}» имеет неверный тип`);
    }
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (required && !s) throw new ApiError(400, `Поле «${field}» обязательно для заполнения`);
    if (s.length > max) throw new ApiError(400, `Поле «${field}» длиннее ${max} символов`);
    return s || null;
}

function date(value, field) {
    const s = text(value, field, { max: 10 });
    if (s && (!DATE_RE.test(s) || Number.isNaN(Date.parse(s)))) {
        throw new ApiError(400, `Поле «${field}» должно быть датой в формате ГГГГ-ММ-ДД`);
    }
    return s;
}

function price(raw) {
    const bad = () => new ApiError(400, 'Цена должна быть неотрицательным числом');
    let value = 0;
    if (typeof raw === 'number') value = raw;
    else if (typeof raw === 'string' && raw.trim() !== '') {
        if (!/^\d+([.,]\d{1,2})?$/.test(raw.trim())) throw bad();
        value = Number(raw.trim().replace(',', '.'));
    } else if (raw !== undefined && raw !== null && raw !== '') {
        throw bad();
    }
    if (!Number.isFinite(value) || value < 0 || value > 9999999999) throw bad();
    return value;
}

function categoryId(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new ApiError(400, 'Некорректное значение поля «Категория»');
    return n;
}

/** Only these columns are ever sent to the database; extra fields of the tool object (id, category...) are dropped. */
export function toolRow(body) {
    return {
        inv_number: text(body.inv_number, 'Инвентарный номер', { required: true, max: 30 }),
        name: text(body.name, 'Наименование', { required: true, max: 120 }),
        category_id: categoryId(body.category_id),
        manufacturer: text(body.manufacturer, 'Производитель', { max: 80 }),
        purchase_date: date(body.purchase_date, 'Дата покупки'),
        price: price(body.price),
        location: text(body.location, 'Место хранения', { max: 120 }),
        note: text(body.note, 'Примечание', { max: 300 }),
    };
}
