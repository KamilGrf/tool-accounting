import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader and expose loading / error / data.
 * On a failed reload the previously loaded data is kept (ERR-NET-01 in the spec).
 * The loader is re-run when `deps` change or `reload()` is called.
 */
export function useAsync(loader, deps = []) {
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const [tick, setTick] = useState(0);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    useEffect(() => {
        let alive = true;
        setState((s) => ({ ...s, loading: true, error: null }));
        loaderRef.current().then(
            (data) => alive && setState({ data, error: null, loading: false }),
            (error) => alive && setState((s) => ({ data: s.data, error, loading: false })),
        );
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick]);

    const reload = useCallback(() => setTick((t) => t + 1), []);
    return { ...state, reload };
}

/** Debounce a fast-changing value (search box). */
export function useDebounced(value, delay = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}

/** Wrap a submit handler: pending flag (blocks double submit) + error message. */
export function useSubmit(action) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const run = async (...args) => {
        if (pending) return false;
        setPending(true);
        setError('');
        try {
            await action(...args);
            return true;
        } catch (e) {
            setError(e.message);
            return false;
        } finally {
            setPending(false);
        }
    };
    return { run, pending, error, setError };
}
