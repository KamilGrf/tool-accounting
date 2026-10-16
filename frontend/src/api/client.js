// Turns Supabase / PostgREST / Auth errors into the two error types the UI understands:
// ApiError ("the server said no", with a status and a user-facing message) and NetworkError ("no connection").
// The database raises user-facing Russian messages with SQLSTATE P0400/P0401/P0403/P0404/P0409
// (see supabase/migrations/..._logic.sql); everything else is mapped here.

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

export const AUTH_EXPIRED = 'auth:expired';

const STATUS_BY_CODE = {
    P0400: 400,
    P0401: 401,
    P0403: 403,
    P0404: 404,
    P0409: 409,
    42501: 403,
    23505: 409,
    23503: 409,
    23514: 400,
    22001: 400,
    22003: 400,
    22007: 400,
    22008: 400,
    '22P02': 400,
    PGRST116: 404,
    PGRST301: 401,
    PGRST303: 401,
};

// Which unique constraint was violated -> what to tell the user.
const UNIQUE_MESSAGES = [
    ['ux_tools_inv_number', 'Инструмент с таким инвентарным номером уже есть'],
    ['categories_name_key', 'Категория с таким названием уже существует'],
    ['ux_issues_open_tool', 'Инструмент нельзя выдать: он уже выдан'],
];

const NETWORK_RE = /failed to fetch|networkerror|load failed|fetch failed|abort/i;
const isNetwork = (e) => NETWORK_RE.test(`${e?.name ?? ''} ${e?.message ?? ''}`);

/** Convert a PostgREST / database error (or a thrown fetch failure). */
export function toApiError(error) {
    // Only string codes are SQLSTATE / PostgREST codes; a DOMException (timeout abort) has a numeric one.
    const code = typeof error?.code === 'string' ? error.code : '';
    if (!code && isNetwork(error)) return new NetworkError();

    const status = STATUS_BY_CODE[code] ?? 500;
    if (status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED)); // expired or invalid token: back to sign-in
    if (code.startsWith('P04')) return new ApiError(status, error.message);
    if (code === '42501') return new ApiError(403, 'Недостаточно прав');
    if (code === '23505') {
        const hit = UNIQUE_MESSAGES.find(([name]) => `${error.message} ${error.details ?? ''}`.includes(name));
        return new ApiError(409, hit ? hit[1] : 'Такая запись уже существует');
    }
    if (code === '23503') return new ApiError(409, 'Операция нарушает связи между данными');
    if (status === 400) return new ApiError(400, 'Некорректные данные в запросе');
    if (status === 404) return new ApiError(404, 'Запись не найдена');
    if (status === 401) return new ApiError(401, 'Требуется вход');
    return new ApiError(500, 'Внутренняя ошибка сервера. Попробуйте позже');
}

// Supabase Auth reports errors with its own string codes.
const AUTH_ERRORS = {
    invalid_credentials: [401, 'Неверный email или пароль'],
    email_not_confirmed: [403, 'Email не подтверждён. Проверьте почту'],
    user_already_exists: [409, 'Пользователь с таким email уже существует'],
    email_exists: [409, 'Пользователь с таким email уже существует'],
    weak_password: [400, 'Пароль не соответствует требованиям (не короче 8 символов)'],
    signup_disabled: [403, 'Регистрация отключена'],
    email_address_invalid: [400, 'Введите корректный email'],
    validation_failed: [400, 'Введите корректный email'],
    over_request_rate_limit: [429, 'Слишком много попыток. Повторите позже'],
    over_email_send_rate_limit: [429, 'Слишком много писем за короткое время. Повторите позже'],
    // The built-in Supabase mailer only writes to a few addresses and can fail otherwise.
    email_address_not_authorized: [
        403,
        'Supabase не может отправить письмо на этот адрес. Отключите подтверждение email в настройках Auth или подключите свою почту (SMTP)',
    ],
    unexpected_failure: [
        500,
        'Не удалось отправить письмо подтверждения. Отключите подтверждение email в настройках Auth или подключите свою почту (SMTP)',
    ],
};

/** Convert a Supabase Auth error. */
export function toAuthError(error) {
    if (error?.status === 0 || isNetwork(error)) return new NetworkError();
    const known = AUTH_ERRORS[error?.code];
    if (known) return new ApiError(known[0], known[1]);
    if (error?.status === 429) return new ApiError(429, 'Слишком много попыток. Повторите позже');
    // Unknown error: name its code (never the raw text) so the cause can be looked up in the Auth logs.
    const hint = error?.code ? ` (код: ${error.code})` : '';
    return new ApiError(error?.status >= 500 ? 500 : 400, `Не удалось выполнить операцию${hint}. Попробуйте позже`);
}

/** Await a Supabase request and return its data; any failure becomes ApiError / NetworkError. */
export async function run(request) {
    let res;
    try {
        res = await request;
    } catch (e) {
        throw toApiError(e);
    }
    if (res.error) throw toApiError(res.error);
    return res.data;
}
