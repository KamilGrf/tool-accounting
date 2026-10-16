import { describe, expect, it } from 'vitest';
import { toolRow } from './toolPayload.js';

const valid = { inv_number: 'ИНВ-1', name: 'Дрель', category_id: '1' };

describe('toolRow', () => {
    it('trims text, turns empty values into null and keeps only table columns', () => {
        const row = toolRow({ ...valid, inv_number: '  ИНВ-1 ', manufacturer: '  ', note: undefined, id: 9, category: 'Электро', status: 'issued' });
        expect(row).toEqual({
            inv_number: 'ИНВ-1', name: 'Дрель', category_id: 1, manufacturer: null,
            purchase_date: null, price: 0, location: null, note: null,
        });
    });

    it('parses the price with a comma or a dot and rejects everything else', () => {
        expect(toolRow({ ...valid, price: '1250,50' }).price).toBe(1250.5);
        expect(toolRow({ ...valid, price: '99.9' }).price).toBe(99.9);
        expect(toolRow({ ...valid, price: 300 }).price).toBe(300);
        for (const bad of ['abc', '-5', '1,234', '1e3', -1, NaN, 99999999999, {}, true]) {
            expect(() => toolRow({ ...valid, price: bad })).toThrow('Цена должна быть неотрицательным числом');
        }
    });

    it('requires the inventory number, the name and a valid category', () => {
        expect(() => toolRow({ ...valid, inv_number: ' ' })).toThrow('Поле «Инвентарный номер» обязательно для заполнения');
        expect(() => toolRow({ ...valid, name: '' })).toThrow('Поле «Наименование» обязательно для заполнения');
        expect(() => toolRow({ ...valid, category_id: '' })).toThrow('Некорректное значение поля «Категория»');
        expect(() => toolRow({ ...valid, category_id: '1.5' })).toThrow('Некорректное значение поля «Категория»');
    });

    it('checks the lengths the database also enforces', () => {
        expect(() => toolRow({ ...valid, inv_number: 'x'.repeat(31) })).toThrow('длиннее 30 символов');
        expect(() => toolRow({ ...valid, note: 'x'.repeat(301) })).toThrow('длиннее 300 символов');
    });

    it('validates the purchase date format', () => {
        expect(toolRow({ ...valid, purchase_date: '2026-05-01' }).purchase_date).toBe('2026-05-01');
        expect(() => toolRow({ ...valid, purchase_date: '01.05.2026' })).toThrow('должно быть датой в формате ГГГГ-ММ-ДД');
    });

    it('rejects values of the wrong type', () => {
        expect(() => toolRow({ ...valid, name: { a: 1 } })).toThrow('имеет неверный тип');
    });
});
