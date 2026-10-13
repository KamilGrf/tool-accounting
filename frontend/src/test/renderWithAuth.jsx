import { render } from '@testing-library/react';
import { AuthContext } from '../auth/AuthContext.jsx';

/** Render a component as a signed-in user without going through the real login flow. */
export function renderWithAuth(ui, user = { id: 1, login: 'manager', role: 'manager' }) {
    const value = { user, checking: false, notice: '', signIn: async () => {}, signOut: async () => {} };
    return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>);
}
