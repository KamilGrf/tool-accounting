import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, query, request } from './client.js';
import { mockFetch } from '../test/mockFetch.js';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
    it('returns parsed JSON on success and null on 204', async () => {
        mockFetch({
            'GET /api/tools': { data: [{ id: 1 }] },
            'DELETE /api/tools/1': { status: 204 },
        });
        expect(await request('GET', '/api/tools')).toEqual([{ id: 1 }]);
        expect(await request('DELETE', '/api/tools/1')).toBeNull();
    });

    it('turns a server error into ApiError carrying the server message and status', async () => {
        mockFetch({ 'POST /api/issues': { status: 409, data: { error: 'Инструмент нельзя выдать: он уже выдан' } } });
        const err = await request('POST', '/api/issues', { tool_id: 1 }).catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(409);
        expect(err.message).toBe('Инструмент нельзя выдать: он уже выдан');
    });

    it('turns a failed fetch into NetworkError (ERR-NET-01)', async () => {
        mockFetch({ 'GET /api/tools': new TypeError('Failed to fetch') });
        await expect(request('GET', '/api/tools')).rejects.toBeInstanceOf(NetworkError);
    });

    it('uses a generic message for a 500 without JSON body', async () => {
        mockFetch({ 'GET /api/stats': { status: 500, data: null } });
        await expect(request('GET', '/api/stats')).rejects.toThrow('Внутренняя ошибка сервера');
    });

    it('builds query strings without empty values', () => {
        expect(query({ q: 'bosch', status: '', category: 2, x: null })).toBe('?q=bosch&category=2');
        expect(query({})).toBe('');
    });
});
