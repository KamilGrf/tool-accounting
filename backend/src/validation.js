'use strict';
const { HttpError } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value, field, { required = false, max = 200 } = {}) {
    // Objects, arrays and booleans would be silently stringified ("[object Object]"): reject them.
    if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new HttpError(400, `Поле «${field}» имеет неверный тип`);
    }
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (required && !s) throw new HttpError(400, `Поле «${field}» обязательно для заполнения`);
    if (s.length > max) throw new HttpError(400, `Поле «${field}» длиннее ${max} символов`);
    return s || null;
}

function date(value, field, { required = false } = {}) {
    const s = text(value, field, { required, max: 10 });
    if (s && (!DATE_RE.test(s) || Number.isNaN(Date.parse(s)))) {
        throw new HttpError(400, `Поле «${field}» должно быть датой в формате ГГГГ-ММ-ДД`);
    }
    return s;
}

function id(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(400, `Некорректное значение поля «${field}»`);
    return n;
}

/** Escape LIKE wildcards so user input is matched literally. */
function likePattern(q) {
    return `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
}

module.exports = { text, date, id, likePattern };
