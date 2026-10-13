import { NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';

const LINKS = [
    { to: '/tools', label: 'Инструменты' },
    { to: '/issues', label: 'Выдача и возврат' },
    { to: '/report', label: 'Отчёт', roles: ['manager'] },
];

/** Corporate layout (concept 3): sidebar on desktop, horizontal ribbon below the lg breakpoint. */
export default function Layout() {
    const { user, signOut } = useAuth();
    const links = LINKS.filter((l) => !l.roles || l.roles.includes(user.role));
    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[13rem_1fr]">
            <aside className="flex flex-col bg-side text-slate-300 lg:py-4">
                <h1 className="px-4 py-3 text-sm font-semibold text-white lg:mb-4 lg:py-0">АС «Учёт инструментов»</h1>
                <nav aria-label="Разделы" className="flex overflow-x-auto lg:block">
                    {links.map((l) => (
                        <NavLink
                            key={l.to}
                            to={l.to}
                            className={({ isActive }) =>
                                `block whitespace-nowrap border-b-4 px-4 py-2.5 hover:bg-side-hover lg:border-b-0 lg:border-l-4 ${
                                    isActive ? 'border-blue-300 bg-side-hover text-white' : 'border-transparent'}`}
                        >
                            {l.label}
                        </NavLink>
                    ))}
                </nav>
                <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm lg:mt-auto lg:block">
                    <div data-testid="whoami">{user.login} · {ROLE_LABELS[user.role]}</div>
                    <button type="button" onClick={signOut} className="underline hover:text-white">Выйти</button>
                </div>
            </aside>
            <main className="min-w-0 p-3 sm:p-5">
                <Outlet />
            </main>
        </div>
    );
}
