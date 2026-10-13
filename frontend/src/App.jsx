import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ToolsPage from './pages/ToolsPage.jsx';
import IssuesPage from './pages/IssuesPage.jsx';
import ReportPage from './pages/ReportPage.jsx';

function Forbidden() {
    return <p role="alert" className="p-4">Недостаточно прав для этого раздела</p>;
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
    return (
        <AuthProvider>
            <AppRoutes />
        </AuthProvider>
    );
}
