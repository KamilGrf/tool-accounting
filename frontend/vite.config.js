import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend URL can be overridden: API_TARGET=http://127.0.0.1:3001 npm run dev
const apiTarget = process.env.API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: { '/api': apiTarget },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.js'],
        css: false,
    },
});
