import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeError, installGlobalErrorLogging, logger, scrub, setLogLevel, setRemoteSink } from './logger.js';

const lastLine = (method) => JSON.parse(console[method].mock.calls.at(-1)[0]);

beforeEach(() => {
    setLogLevel('debug');
    setRemoteSink(null);
    window.history.replaceState(null, '', '/');
    for (const method of ['debug', 'info', 'warn', 'error']) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
    setLogLevel('silent');
    setRemoteSink(null);
    vi.restoreAllMocks();
});

describe('log entries', () => {
    it('are one JSON object per line with time, level, message, context, route and release', () => {
        logger.info('hello', { a: 1 });
        const entry = lastLine('info');
        expect(Object.keys(entry).sort()).toEqual(['context', 'level', 'message', 'release', 'route', 'ts']);
        expect(entry).toMatchObject({ level: 'info', message: 'hello', context: { a: 1 }, route: '/', release: 'dev' });
        expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
    });

    it('go to the console method of their level', () => {
        for (const level of ['debug', 'info', 'warn', 'error']) logger[level](`m-${level}`);
        for (const level of ['debug', 'info', 'warn', 'error']) expect(lastLine(level).message).toBe(`m-${level}`);
    });

    it('record only the path of the page, never the query string', () => {
        window.history.replaceState(null, '', '/tools?access_token=secret&x=1');
        logger.info('where');
        expect(lastLine('info').route).toBe('/tools');
    });
});

describe('level threshold', () => {
    it('drops everything below the threshold', () => {
        setLogLevel('warn');
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledOnce();
        expect(console.error).toHaveBeenCalledOnce();
    });

    it('"silent" switches the output off completely', () => {
        setLogLevel('silent');
        logger.error('e');
        expect(console.error).not.toHaveBeenCalled();
    });

    it('ignores an unknown level name', () => {
        setLogLevel('warn');
        setLogLevel('verbose');
        logger.info('still dropped');
        expect(console.info).not.toHaveBeenCalled();
    });
});

describe('scrub (nothing personal leaves the browser)', () => {
    it('masks e-mail addresses inside texts', () => {
        expect(scrub('login of ivan.petrov@example.com failed')).toBe('login of [email] failed');
        logger.warn('user ivan@test.ru did something', { note: 'mail me: a@b.co' });
        const entry = lastLine('warn');
        expect(entry.message).toBe('user [email] did something');
        expect(entry.context.note).toBe('mail me: [email]');
    });

    it('hides the values of fields that look like secrets or personal data', () => {
        const out = scrub({
            password: 'p',
            Token: 't',
            email: 'a@b.co',
            authorization: 'Bearer x',
            apiKey: 'k',
            phone: '1',
            userPhone: '2',
            status: 500,
        });
        expect(out).toEqual({
            password: '[hidden]',
            Token: '[hidden]',
            email: '[hidden]',
            authorization: '[hidden]',
            apiKey: '[hidden]',
            phone: '[hidden]',
            userPhone: '[hidden]',
            status: 500,
        });
    });

    it('cuts long texts', () => {
        const out = scrub('x'.repeat(500));
        expect(out).toHaveLength(301);
        expect(out.endsWith('…')).toBe(true);
    });

    it('limits depth and size so a huge or circular object cannot blow up a log line', () => {
        const circular = { name: 'loop' };
        circular.self = circular;
        expect(() => JSON.stringify(scrub(circular))).not.toThrow();
        expect(scrub({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: '[…]' } } });
        expect(scrub(Array.from({ length: 50 }, (_, i) => i))).toHaveLength(20);
        expect(Object.keys(scrub(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))))).toHaveLength(20);
    });

    it('keeps numbers, booleans and empty values, and stringifies the rest', () => {
        expect(scrub(0)).toBe(0);
        expect(scrub(false)).toBe(false);
        expect(scrub(null)).toBeNull();
        expect(scrub(undefined)).toBeUndefined();
        expect(scrub(Symbol('s'))).toBe('Symbol(s)');
    });
});

describe('central log (remote sink)', () => {
    it('receives warnings and errors, but not debug or info', () => {
        const sink = vi.fn(async () => {});
        setRemoteSink(sink);
        logger.debug('d');
        logger.info('i');
        logger.warn('w', { op: 'x' });
        logger.error('e');
        expect(sink).toHaveBeenCalledTimes(2);
        expect(sink.mock.calls[0][0]).toMatchObject({ level: 'warn', message: 'w', context: { op: 'x' } });
        expect(sink.mock.calls[1][0]).toMatchObject({ level: 'error', message: 'e' });
    });

    it('receives the scrubbed entry, not the raw one', () => {
        const sink = vi.fn(async () => {});
        setRemoteSink(sink);
        logger.error('failed for ivan@test.ru', { password: 'secret' });
        expect(sink.mock.calls[0][0].message).toBe('failed for [email]');
        expect(sink.mock.calls[0][0].context).toEqual({ password: '[hidden]' });
    });

    it('is not used after it was switched off (signed out)', () => {
        const sink = vi.fn(async () => {});
        setRemoteSink(sink);
        setRemoteSink(null);
        logger.error('e');
        expect(sink).not.toHaveBeenCalled();
    });

    it('is not used for entries below the console threshold', () => {
        const sink = vi.fn(async () => {});
        setRemoteSink(sink);
        setLogLevel('silent');
        logger.error('e');
        expect(sink).not.toHaveBeenCalled();
    });

    it('sends at most 20 entries per page view', () => {
        const sink = vi.fn(async () => {});
        setRemoteSink(sink);
        for (let i = 0; i < 50; i += 1) logger.error(`loop ${i}`);
        expect(sink).toHaveBeenCalledTimes(20);
        expect(console.error).toHaveBeenCalledTimes(50); // the console still gets everything
    });

    it('never breaks the app when the sink fails, asynchronously or at once', async () => {
        setRemoteSink(vi.fn(async () => Promise.reject(new Error('network down'))));
        expect(() => logger.error('a')).not.toThrow();
        setRemoteSink(
            vi.fn(() => {
                throw new Error('boom');
            }),
        );
        expect(() => logger.error('b')).not.toThrow();
        await Promise.resolve();
    });

    it('never breaks the app when the console itself fails', () => {
        console.warn.mockImplementation(() => {
            throw new Error('console is broken');
        });
        expect(() => logger.warn('w')).not.toThrow();
    });
});

describe('describeError', () => {
    it('keeps the name, the message and the first five lines of the stack', () => {
        const error = new TypeError('bad thing');
        error.stack = ['TypeError: bad thing', ...Array.from({ length: 10 }, (_, i) => `    at fn${i}`)].join('\n');
        const info = describeError(error);
        expect(info).toMatchObject({ name: 'TypeError', message: 'bad thing' });
        expect(info.stack.split('\n')).toHaveLength(5);
    });

    it('copes with things that are not errors', () => {
        expect(describeError('plain text')).toEqual({ message: 'plain text' });
        expect(describeError(null)).toEqual({ message: 'null' });
        expect(describeError(undefined)).toEqual({ message: 'undefined' });
    });
});

describe('installGlobalErrorLogging', () => {
    function fakeTarget() {
        const handlers = {};
        return {
            handlers,
            addEventListener: (type, fn) => {
                handlers[type] = fn;
            },
            removeEventListener: (type) => {
                delete handlers[type];
            },
        };
    }

    it('logs uncaught errors and unhandled promise rejections', () => {
        const target = fakeTarget();
        installGlobalErrorLogging(target);
        target.handlers.error({ message: 'x is not a function', filename: 'app.js', lineno: 10, colno: 5 });
        expect(lastLine('error')).toMatchObject({
            message: 'uncaught_error',
            context: { message: 'x is not a function', source: 'app.js', line: 10, column: 5 },
        });
        target.handlers.unhandledrejection({ reason: new RangeError('too big') });
        expect(lastLine('error')).toMatchObject({ message: 'unhandled_rejection', context: { name: 'RangeError', message: 'too big' } });
    });

    it('returns a function that removes the listeners', () => {
        const target = fakeTarget();
        const remove = installGlobalErrorLogging(target);
        expect(Object.keys(target.handlers).sort()).toEqual(['error', 'unhandledrejection']);
        remove();
        expect(target.handlers).toEqual({});
    });
});
