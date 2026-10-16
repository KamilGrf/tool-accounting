-- 006: central storage for the application's own log entries (errors and warnings of the browser app).
-- Signed-in users can only append through log_client_event (size and rate limited); only managers can read.
-- The table itself is closed to everybody: RLS is on and there are no policies and no grants.

create table public.client_logs (
    id         bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    level      text not null check (level in ('debug', 'info', 'warn', 'error')),
    message    text not null check (char_length(message) between 1 and 500),
    context    jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 4000),
    route      text check (route is null or char_length(route) <= 200),
    release    text check (release is null or char_length(release) <= 40),
    -- Pseudonymous: the id of the signed-in user, never an e-mail or a name.
    user_id    uuid references public.profiles (id) on delete set null
);
create index ix_client_logs_created on public.client_logs (created_at desc);
create index ix_client_logs_level on public.client_logs (level, created_at desc);

alter table public.client_logs enable row level security;
revoke all on public.client_logs from anon, authenticated;

create function public.log_client_event(
    p_level   text,
    p_message text,
    p_context jsonb default '{}'::jsonb,
    p_route   text default null,
    p_release text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_context jsonb := coalesce(p_context, '{}'::jsonb);
begin
    if not public.is_staff() then
        raise exception 'Требуется вход' using errcode = 'P0401';
    end if;
    if p_level is null or p_level not in ('debug', 'info', 'warn', 'error') then
        raise exception 'Неизвестный уровень журнала' using errcode = 'P0400';
    end if;
    if coalesce(btrim(p_message), '') = '' then
        raise exception 'Пустое сообщение журнала' using errcode = 'P0400';
    end if;
    if jsonb_typeof(v_context) <> 'object' or octet_length(v_context::text) > 4000 then
        raise exception 'Контекст должен быть объектом не больше 4000 байт' using errcode = 'P0400';
    end if;
    -- A broken client must not flood the table: at most 30 entries per user per minute.
    if (select count(*) from public.client_logs where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 30 then
        raise exception 'Слишком много записей журнала' using errcode = 'P0429';
    end if;

    insert into public.client_logs (level, message, context, route, release, user_id)
    values (p_level, left(btrim(p_message), 500), v_context, left(p_route, 200), left(p_release, 40), auth.uid());
end;
$$;

create function public.list_client_logs(p_level text default null, p_limit integer default 100)
returns setof public.client_logs
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    return query
    select * from public.client_logs l
    where p_level is null or l.level = p_level
    order by l.created_at desc, l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Retention: call it from time to time (or schedule it with pg_cron where available).
create function public.purge_client_logs(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    delete from public.client_logs where created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 0));
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

revoke all on function
    public.log_client_event(text, text, jsonb, text, text),
    public.list_client_logs(text, integer),
    public.purge_client_logs(integer)
from public, anon;
grant execute on function
    public.log_client_event(text, text, jsonb, text, text),
    public.list_client_logs(text, integer),
    public.purge_client_logs(integer)
to authenticated;

notify pgrst, 'reload schema';
