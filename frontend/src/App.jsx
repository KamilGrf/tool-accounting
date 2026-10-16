import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isConfigured } from './api/index.js';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import ConsentBanner from './components/ConsentBanner.jsx';
import Layout from './components/Layout.jsx';
import PageTracker from './components/PageTracker.jsx';
import { Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PendingPage from './pages/PendingPage.jsx';

// Pages are loaded when first opened: the sign-in screen does not download the report or user management code.
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'));
const ToolsPage = lazy(() => import('./pages/ToolsPage.jsx'));
const IssuesPage = lazy(() => import('./pages/IssuesPage.jsx'));
const ReportPage = lazy(() => import('./pages/ReportPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));

function MissingConfig() {
    return (
        <div role="alert" className="m-4 rounded border border-red-300 bg-red-50 p-4 text-red-800">
            <h1 className="font-semibold">Приложение не настроено</h1>
            <p className="mt-1 text-sm">
                Не заданы переменные <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code>. Укажите их (файл{' '}
                <code>.env</code> локально или настройки проекта на хостинге) и пересоберите приложение.
            </p>
        </div>
    );
}

function Forbidden() {
    return (
        <p role="alert" className="p-4">
            Недостаточно прав для этого раздела
        </p>
    );
}

function AppRoutes() {
    const { user, checking } = useAuth();
    const { pathname } = useLocation();
    if (pathname === '/privacy')
        return (
            <Suspense fallback={<Spinner />}>
                <PrivacyPage />
            </Suspense>
        ); // public: Google requires a policy link, no sign-in needed
    if (checking) return <Spinner />;
    if (!user) return <LoginPage />; // ERR-AUTH-01: no session -> sign-in screen
    if (user.role === 'pending') return <PendingPage />; // not approved yet: no data, no menu

    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<Navigate to="/tools" replace />} />
                <Route path="tools" element={<ToolsPage />} />
                <Route path="issues" element={<IssuesPage />} />
                {/* The server enforces this too; the guard only avoids showing a page that would fail. */}
                <Route path="report" element={user.role === 'manager' ? <ReportPage /> : <Forbidden />} />
                <Route path="users" element={user.role === 'manager' ? <UsersPage /> : <Forbidden />} />
                <Route path="*" element={<p className="p-4">Страница не найдена</p>} />
            </Route>
        </Routes>
    );
}

export default function App() {
    if (!isConfigured) return <MissingConfig />;
    return (
        <AuthProvider>
            <PageTracker />
            <AppRoutes />
            <ConsentBanner />
        </AuthProvider>
    );
}
