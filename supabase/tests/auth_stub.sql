-- Minimal stand-in for the parts of Supabase the migrations depend on, for a plain PostgreSQL 16 test database.
-- Real Supabase has all of this already; DO NOT run this file there.

create schema auth;

create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz
);

-- Same definition as in Supabase: PostgREST puts the verified token into request.jwt.claims (JSON);
-- the old per-claim setting is still honoured so the SQL tests can set it directly.
create function auth.uid()
returns uuid
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

create role anon nologin;
create role authenticated nologin;
-- PostgREST connects as this role and switches to anon / authenticated per request (as in Supabase).
create role authenticator noinherit login password 'test';
grant anon, authenticated to authenticator;

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
