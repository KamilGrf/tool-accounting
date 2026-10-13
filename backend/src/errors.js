'use strict';

/** Error with an HTTP status; the message is safe to show to the user. */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// PostgreSQL error classes that mean "the client sent bad data", not "the server broke".
const PG_BAD_INPUT = new Set(['22003', '22007', '22008', '22P02', '22001', '23514']);

// Errors meaning "the database cannot be reached right now" (network, restart, pool timeout).
const PG_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', '57P01', '57P03', '08001', '08006']);
const isDbUnavailable = (err) => Boolean(err) && (PG_UNAVAILABLE_CODES.has(err.code) || /timeout exceeded when trying to connect|Connection terminated/i.test(err.message || ''));

/** Translate low-level database errors into HttpError where the cause is the request. */
function fromDbError(err) {
    if (err instanceof HttpError) return err;
    if (isDbUnavailable(err)) return new HttpError(503, 'Сервис временно недоступен. Попробуйте позже');
    if (err && PG_BAD_INPUT.has(err.code)) return new HttpError(400, 'Некорректные данные в запросе');
    if (err && err.code === '23503') return new HttpError(409, 'Операция нарушает связи между данными');
    if (err && err.code === '23505') return new HttpError(409, 'Такая запись уже существует'); // safety net: specific messages are raised earlier
    return err;
}

module.exports = { HttpError, fromDbError, isDbUnavailable };
