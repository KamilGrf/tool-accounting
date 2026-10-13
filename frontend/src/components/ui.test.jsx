import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBanner, StatusBadge } from './ui.jsx';
import { NetworkError, ApiError } from '../api/client.js';

describe('StatusBadge', () => {
    it('shows a text label for every status, not just a colour', () => {
        const { rerender } = render(<StatusBadge status="in_stock" />);
        expect(screen.getByText('На складе')).toBeInTheDocument();
        rerender(<StatusBadge status="repair" />);
        expect(screen.getByText('В ремонте')).toBeInTheDocument();
    });
});

describe('ErrorBanner', () => {
    it('renders nothing without an error', () => {
        const { container } = render(<ErrorBanner error={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a friendly connection message for NetworkError and calls retry', async () => {
        const onRetry = vi.fn();
        render(<ErrorBanner error={new NetworkError()} onRetry={onRetry} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить данные. Проверьте соединение');
        await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('shows the server message for ApiError', () => {
        render(<ErrorBanner error={new ApiError(500, 'Внутренняя ошибка сервера')} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Внутренняя ошибка сервера');
    });
});
