import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// No backend to proxy to: the app talks to Supabase directly (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.js'],
        css: false,
    },
});
