-- 005: health probe for monitoring (used by /api/health).
-- Callable without signing in on purpose, and it reveals nothing except "the database answers".

create function public.health()
returns jsonb
language sql
stable
set search_path = ''
as $$ select jsonb_build_object('ok', true, 'time', now()) $$;

revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

notify pgrst, 'reload schema';
