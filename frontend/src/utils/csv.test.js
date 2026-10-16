import { describe, expect, it } from 'vitest';
import { buildOverdueCsv, csvCell } from './csv.js';

describe('csvCell', () => {
    it('leaves plain values alone and quotes separators, quotes and line breaks', () => {
        expect(csvCell('Дрель')).toBe('Дрель');
        expect(csvCell('а;б')).toBe('"а;б"');
        expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
        expect(csvCell('строка1\nстрока2')).toBe('"строка1\nстрока2"');
    });

    it('prefixes values that Excel would run as formulas (CSV injection)', () => {
        for (const evil of ['=SUM(A1)', '+1', '-2', '@cmd', '\t=1']) {
            expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
        }
        expect(csvCell(-5)).toBe('-5'); // a real negative number is not text
    });

    it('writes empty cells for null and undefined', () => {
        expect(csvCell(null)).toBe('');
        expect(csvCell(undefined)).toBe('');
    });
});

describe('buildOverdueCsv', () => {
    const issue = { inv_number: 'ИНВ-0001', tool_name: '=Дрель', employee_name: 'Иванов', department: null, issued_at: '2026-01-01', due_at: '2026-01-05' };

    it('starts with a BOM and the header, uses ";" and CRLF', () => {
        const csv = buildOverdueCsv([issue], '2026-01-10');
        expect(csv.startsWith('﻿Инв. номер;Инструмент;Сотрудник;Подразделение;Выдан;Срок возврата;Дней просрочки\r\n')).toBe(true);
        expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('counts the days of delay and guards formulas in data', () => {
        const [, row] = buildOverdueCsv([issue], '2026-01-10').trim().split('\r\n');
        expect(row).toBe("ИНВ-0001;'=Дрель;Иванов;;2026-01-01;2026-01-05;5");
    });

    it('is just the header when nothing is overdue', () => {
        expect(buildOverdueCsv([], '2026-01-10').trim().split('\r\n')).toHaveLength(1);
    });
});
