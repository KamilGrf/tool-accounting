// The one place that creates the Supabase client. The anon key is public by design:
// what a visitor may read or change is decided by the database (RLS policies and functions).
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);
export const REQUEST_TIMEOUT_MS = 15000;

/** fetch with a timeout: a hung connection becomes an ordinary network error (see client.js). */
function fetchWithTimeout(input, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (init.signal) init.signal.addEventListener('abort', () => controller.abort());
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Placeholders keep createClient from throwing when the variables are missing:
// the app shows a configuration message and never calls the client in that case.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing-key', {
    global: { fetch: fetchWithTimeout },
    auth: { persistSession: true, autoRefreshToken: true },
});
