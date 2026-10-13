// Endpoints of the existing backend (App from DZ1/DZ2). One function per use case.
import { request, query } from './client.js';

export const authApi = {
    me: () => request('GET', '/api/auth/me'),
    login: (body) => request('POST', '/api/auth/login', body),
    register: (body) => request('POST', '/api/auth/register', body),
    logout: () => request('POST', '/api/auth/logout', {}),
};

export const toolsApi = {
    list: (params) => request('GET', `/api/tools${query(params)}`),
    create: (body) => request('POST', '/api/tools', body),
    update: (id, body) => request('PUT', `/api/tools/${id}`, body),
};

export const issuesApi = {
    list: (params) => request('GET', `/api/issues${query(params)}`),
    issue: (body) => request('POST', '/api/issues', body),
    returnTool: (id, body) => request('POST', `/api/issues/${id}/return`, body),
    extend: (id, body) => request('POST', `/api/issues/${id}/extend`, body),
};

export const employeesApi = { list: (params) => request('GET', `/api/employees${query(params)}`) };
export const categoriesApi = { list: () => request('GET', '/api/categories') };
export const statsApi = {
    get: () => request('GET', '/api/stats'),
    usage: () => request('GET', '/api/report/usage'),
};

export const OVERDUE_CSV_URL = '/api/report/overdue.csv';
