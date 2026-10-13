// Thin fetch wrapper: JSON in/out, timeout, and two distinct error types
// so the UI can tell "server said no" (ApiError) from "no connection" (NetworkError).

export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

export class NetworkError extends Error {
    constructor(message = 'Не удалось связаться с сервером. Проверьте соединение') {
        super(message);
        this.name = 'NetworkError';
    }
}

export const TIMEOUT_MS = 15000;
export const AUTH_EXPIRED = 'auth:expired';

export async function request(method, url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch {
        throw new NetworkError();
    } finally {
        clearTimeout(timer);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
        // Session expired or missing: let the auth context show the login screen (ERR-AUTH-03).
        window.dispatchEvent(new Event(AUTH_EXPIRED));
    }
    if (!res.ok) {
        const fallback = res.status >= 500 ? 'Внутренняя ошибка сервера. Попробуйте позже' : `Ошибка ${res.status}`;
        throw new ApiError(res.status, data?.error || fallback);
    }
    return data;
}

/** Build "?a=1&b=2" from an object, skipping empty values. */
export function query(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) q.set(k, v);
    });
    const s = q.toString();
    return s ? `?${s}` : '';
}
