import { Component } from 'react';
import { describeError, logger } from '../logger.js';

/** Last line of defence: a crash while rendering shows a message instead of a blank page, and is logged. */
export default class ErrorBoundary extends Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error, info) {
        logger.error('render_crash', { ...describeError(error), componentStack: info?.componentStack?.slice(0, 600) });
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div role="alert" className="mx-auto mt-10 max-w-md rounded border border-red-300 bg-red-50 p-5 text-red-900">
                <h1 className="font-semibold">Что-то пошло не так</h1>
                <p className="mt-1 text-sm">
                    Произошла непредвиденная ошибка, сведения о ней записаны в журнал. Обновите страницу, чтобы продолжить.
                </p>
                <button
                    type="button"
                    className="mt-3 rounded border border-red-700 bg-white px-3 py-1.5 text-sm text-red-800 hover:bg-red-100"
                    onClick={() => window.location.reload()}
                >
                    Обновить страницу
                </button>
            </div>
        );
    }
}
