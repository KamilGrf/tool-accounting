import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './api/index.js';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import ConsentBanner from './components/ConsentBanner.jsx';
import Layout from './components/Layout.jsx';
import PageTracker from './components/PageTracker.jsx';
import { Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ToolsPage from './pages/ToolsPage.jsx';
import IssuesPage from './pages/IssuesPage.jsx';
import ReportPage from './pages/ReportPage.jsx';

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
    if (checking) return <Spinner />;
    if (!user) return <LoginPage />; // ERR-AUTH-01: no session -> sign-in screen

    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<Navigate to="/tools" replace />} />
                <Route path="tools" element={<ToolsPage />} />
                <Route path="issues" element={<IssuesPage />} />
                {/* The server enforces this too; the guard only avoids showing a page that would fail. */}
                <Route path="report" element={user.role === 'manager' ? <ReportPage /> : <Forbidden />} />
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
