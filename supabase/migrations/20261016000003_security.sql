-- 003: Row Level Security and table privileges.
-- Default is "deny": anonymous visitors get nothing; signed-in staff get exactly what the old Node API allowed.
-- Issues are never written directly by clients, only through the functions in 004.

alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.tools      enable row level security;
alter table public.employees  enable row level security;
alter table public.issues     enable row level security;

-- Supabase grants broad default privileges to anon/authenticated: start from zero.
revoke all on public.profiles, public.categories, public.tools, public.employees, public.issues from anon, authenticated;

grant select on public.profiles to authenticated;                                  -- own row only (policy)
grant select, insert, update, delete on public.categories, public.employees to authenticated;
grant select, insert, update, delete on public.tools to authenticated;             -- delete: managers only (policy)
grant select on public.issues to authenticated;                                    -- writes go through functions

create policy profiles_select_own on public.profiles
    for select to authenticated using (id = (select auth.uid()));

create policy categories_select on public.categories for select to authenticated using (public.is_staff());
create policy categories_insert on public.categories for insert to authenticated with check (public.is_staff());
create policy categories_update on public.categories for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy categories_delete on public.categories for delete to authenticated using (public.is_staff());

create policy employees_select on public.employees for select to authenticated using (public.is_staff());
create policy employees_insert on public.employees for insert to authenticated with check (public.is_staff());
create policy employees_update on public.employees for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy employees_delete on public.employees for delete to authenticated using (public.is_staff());

create policy tools_select on public.tools for select to authenticated using (public.is_staff());
create policy tools_insert on public.tools for insert to authenticated with check (public.is_staff());
create policy tools_update on public.tools for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tools_delete on public.tools for delete to authenticated using (public.is_manager());

create policy issues_select on public.issues for select to authenticated using (public.is_staff());
