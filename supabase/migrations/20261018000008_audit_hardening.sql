-- 008: fixes from the independent security review of migration 007 and the earlier ones.
--  1. A tool can only be created "in stock" (the status guard trigger reacts to UPDATE only, so an INSERT with
--     status 'issued' or 'written_off' made a tool nobody could return or restore).
--  2. Deleting categories and employees is for managers (as for tools): a storekeeper must not erase the directory.
--  3. The audit trail of role changes lives in its own closed table: it cannot be forged through log_client_event
--     (which any approved user may call) and is not removed by purge_client_logs.
--  4. Role changes are serialized: two managers demoting each other at the same moment can no longer leave nobody in charge.
--  5. log_client_event has a daily cap per user on top of the per-minute one (bounds how much one account can store).
--  6. Return dates are bounded: at most a year after the issue date (a due date in the year 9999 hid an overdue loan).
--  7. list_users also tells whether the e-mail of an account is confirmed.

-- ---------------------------------------------------------------- 1. tools are created in stock
drop policy tools_insert on public.tools;
create policy tools_insert on public.tools
    for insert to authenticated with check (public.is_staff() and status = 'in_stock');

-- ---------------------------------------------------------------- 2. deleting the directory is for managers
drop policy categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated using (public.is_manager());
drop policy employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated using (public.is_manager());

-- ---------------------------------------------------------------- 3. audit trail
create table public.audit_log (
    id         bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    actor      uuid references public.profiles (id) on delete set null,
    action     text not null check (char_length(action) between 1 and 60),
    target     uuid,
    details    jsonb not null default '{}'::jsonb
);
create index ix_audit_log_created on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

create function public.list_audit_log(p_limit integer default 100)
returns setof public.audit_log
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
    select * from public.audit_log a
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.list_audit_log(integer) from public, anon;
grant execute on function public.list_audit_log(integer) to authenticated;

-- ---------------------------------------------------------------- 4. role changes: serialized and audited
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_old text;
begin
    -- One role change at a time. The lock is taken BEFORE the permission check, so a manager who has just been
    -- demoted by a concurrent change fails the check below. A manager cannot change his own role, so the person
    -- who makes a change is still a manager afterwards: the system is never left without one.
    perform pg_advisory_xact_lock(hashtext('set_user_role'));

    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    if p_role is null or p_role not in ('pending', 'storekeeper', 'manager') then
        raise exception 'Неизвестная роль' using errcode = 'P0400';
    end if;
    if p_user_id = auth.uid() then
        raise exception 'Нельзя изменить собственную роль' using errcode = 'P0409';
    end if;

    select role into v_old from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'Пользователь не найден' using errcode = 'P0404';
    end if;

    update public.profiles set role = p_role where id = p_user_id;
    insert into public.audit_log (actor, action, target, details)
    values (auth.uid(), 'role_changed', p_user_id, jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- ---------------------------------------------------------------- 5. the journal: a daily cap per user
create index ix_client_logs_user_created on public.client_logs (user_id, created_at desc);

create or replace function public.log_client_event(
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
    -- A broken client must not flood the table: at most 30 entries per minute and 500 per day for one user.
    if (select count(*) from public.client_logs where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 30 then
        raise exception 'Слишком много записей журнала' using errcode = 'P0429';
    end if;
    if (select count(*) from public.client_logs where user_id = auth.uid() and created_at > now() - interval '1 day') >= 500 then
        raise exception 'Дневной лимит записей журнала исчерпан' using errcode = 'P0429';
    end if;

    insert into public.client_logs (level, message, context, route, release, user_id)
    values (p_level, left(btrim(p_message), 500), v_context, left(p_route, 200), left(p_release, 40), auth.uid());
end;
$$;

-- ---------------------------------------------------------------- 6. bounded return dates
create or replace function public.issue_tool(p_tool_id integer, p_employee_id integer, p_due_at date, p_issued_at date default null)
returns public.v_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_issued   date := coalesce(p_issued_at, public.today_local());
    v_tool     public.tools%rowtype;
    v_login    text;
    v_issue_id integer;
    v_result   public.v_issues;
begin
    if not public.is_staff() then
        raise exception 'Требуется вход' using errcode = 'P0401';
    end if;
    if p_tool_id is null then
        raise exception 'Поле «Инструмент» обязательно для заполнения' using errcode = 'P0400';
    end if;
    if p_employee_id is null then
        raise exception 'Поле «Сотрудник» обязательно для заполнения' using errcode = 'P0400';
    end if;
    if p_due_at is null then
        raise exception 'Поле «Срок возврата» обязательно для заполнения' using errcode = 'P0400';
    end if;
    if p_due_at < v_issued then
        raise exception 'Срок возврата не может быть раньше даты выдачи' using errcode = 'P0400';
    end if;
    if p_due_at > v_issued + 366 then
        raise exception 'Срок возврата не может быть позже чем через год после выдачи' using errcode = 'P0400';
    end if;

    -- Lock the tool row so two concurrent issues of the same tool are serialized.
    select * into v_tool from public.tools where id = p_tool_id for update;
    if not found then
        raise exception 'Инструмент не найден' using errcode = 'P0404';
    end if;
    perform 1 from public.employees where id = p_employee_id;
    if not found then
        raise exception 'Сотрудник не найден' using errcode = 'P0404';
    end if;
    if v_tool.status <> 'in_stock' then
        raise exception 'Инструмент нельзя выдать: он %',
            case v_tool.status when 'issued' then 'уже выдан' when 'repair' then 'находится в ремонте' else 'списан' end
            using errcode = 'P0409';
    end if;

    select email into v_login from public.profiles where id = auth.uid();
    insert into public.issues (tool_id, employee_id, issued_at, due_at, issued_by, issued_by_login)
    values (p_tool_id, p_employee_id, v_issued, p_due_at, auth.uid(), v_login)
    returning id into v_issue_id;

    perform set_config('app.internal_status_change', 'on', true);
    update public.tools set status = 'issued' where id = p_tool_id;
    perform set_config('app.internal_status_change', 'off', true);

    select * into v_result from public.v_issues where id = v_issue_id;
    return v_result;
end;
$$;

create or replace function public.extend_issue(p_issue_id integer, p_due_at date)
returns public.v_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_issue  public.issues%rowtype;
    v_result public.v_issues;
begin
    if not public.is_staff() then
        raise exception 'Требуется вход' using errcode = 'P0401';
    end if;
    if p_due_at is null then
        raise exception 'Поле «Новый срок возврата» обязательно для заполнения' using errcode = 'P0400';
    end if;

    select * into v_issue from public.issues where id = p_issue_id for update;
    if not found then
        raise exception 'Запись о выдаче не найдена' using errcode = 'P0404';
    end if;
    if v_issue.returned_at is not null then
        raise exception 'Инструмент уже возвращён, срок продлить нельзя' using errcode = 'P0409';
    end if;
    if p_due_at <= v_issue.due_at then
        raise exception 'Новый срок возврата должен быть позже текущего' using errcode = 'P0400';
    end if;
    if p_due_at > v_issue.issued_at + 366 then
        raise exception 'Срок возврата не может быть позже чем через год после выдачи' using errcode = 'P0400';
    end if;

    update public.issues set due_at = p_due_at where id = p_issue_id;
    select * into v_result from public.v_issues where id = p_issue_id;
    return v_result;
end;
$$;

-- ---------------------------------------------------------------- 7. managers see whether an e-mail is confirmed
-- (with "Confirm email" switched off anybody can register with somebody else's address: approve only people you know)
drop function public.list_users();
create function public.list_users()
returns table (id uuid, email text, role text, created_at timestamptz, email_confirmed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    return query
    select p.id, p.email, p.role, p.created_at, (u.email_confirmed_at is not null)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by (p.role = 'pending') desc, p.created_at desc;
end;
$$;

revoke all on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;

notify pgrst, 'reload schema';
