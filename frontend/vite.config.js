import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// No backend to proxy to: the app talks to Supabase directly (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
export default defineConfig({
    plugins: [react(), tailwindcss()],
    // The commit that was built (set by Vercel), recorded in every log entry as "release".
    define: { 'import.meta.env.VITE_RELEASE': JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)) },
    build: {
        rolldownOptions: {
            output: {
                // Libraries change rarely: separate files stay in the browser cache across releases of the application.
                codeSplitting: {
                    groups: [
                        { name: 'supabase', test: /node_modules.@supabase/ },
                        { name: 'react', test: /node_modules.(react|react-dom|react-router|react-router-dom|scheduler)./ },
                    ],
                },
            },
        },
    },
    server: { port: 5173 },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.js'],
        css: false,
    },
});
