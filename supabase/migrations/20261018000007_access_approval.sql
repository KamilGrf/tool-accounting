-- 007: security audit fixes.
--  1. A new account is "pending" and sees nothing until a manager approves it (before this, anybody who registered
--     became a storekeeper at once and could read the staff directory and change the catalogue).
--  2. Managers get functions to list users and set their role (the change is journaled).
--  3. Data minimization: the e-mail of the person who issued a tool is no longer handed out, only its local part.

-- ---------------------------------------------------------------- roles: pending by default
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending', 'storekeeper', 'manager'));
alter table public.profiles alter column role set default 'pending';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Nothing the client sends (user metadata included) can change the role: always "pending".
    insert into public.profiles (id, email, role)
    values (new.id, coalesce(new.email, ''), 'pending');
    return new;
end;
$$;

-- "Staff" are approved users only. Every policy and function that checks is_staff() now refuses pending accounts.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('storekeeper', 'manager')) $$;

-- ---------------------------------------------------------------- data minimization
create or replace view public.v_issues with (security_invoker = true) as
select i.id, i.tool_id, t.inv_number, t.name as tool_name,
       i.employee_id, e.full_name as employee_name, e.department,
       i.issued_at, i.due_at, i.returned_at, i.condition_note,
       split_part(i.issued_by_login, '@', 1) as issued_by,
       case when i.returned_at is null and i.due_at < public.today_local() then 1 else 0 end as overdue
from public.issues i
join public.tools t on t.id = i.tool_id
join public.employees e on e.id = i.employee_id;

-- ---------------------------------------------------------------- user management (managers only)
create function public.list_users()
returns table (id uuid, email text, role text, created_at timestamptz)
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
    select p.id, p.email, p.role, p.created_at
    from public.profiles p
    order by (p.role = 'pending') desc, p.created_at desc;
end;
$$;

create function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    if p_role is null or p_role not in ('pending', 'storekeeper', 'manager') then
        raise exception 'Неизвестная роль' using errcode = 'P0400';
    end if;
    -- A manager cannot change his own role: the system can never be left without a manager by one's own hand.
    if p_user_id = auth.uid() then
        raise exception 'Нельзя изменить собственную роль' using errcode = 'P0409';
    end if;

    update public.profiles set role = p_role where id = p_user_id;
    if not found then
        raise exception 'Пользователь не найден' using errcode = 'P0404';
    end if;

    -- Audit trail: who gave which role to whom.
    insert into public.client_logs (level, message, context, user_id)
    values ('info', 'role_changed', jsonb_build_object('target', p_user_id, 'role', p_role), auth.uid());
end;
$$;

revoke all on function public.list_users(), public.set_user_role(uuid, text) from public, anon;
grant execute on function public.list_users(), public.set_user_role(uuid, text) to authenticated;

notify pgrst, 'reload schema';
