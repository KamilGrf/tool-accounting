-- 002: profile for every Auth user + helpers used by RLS policies and functions.

-- Every new Auth user becomes a storekeeper. Nothing the client sends (user metadata included) can change that.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email, role)
    values (new.id, coalesce(new.email, ''), 'storekeeper');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- "Business today": overdue logic follows the business time zone, not the server's UTC.
create function public.today_local()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Moscow')::date $$;

-- Any signed-in user that has a profile.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid())) $$;

create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'manager') $$;

-- Escape LIKE wildcards so user input is matched literally.
create function public.escape_like(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$ select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.today_local(), public.is_staff(), public.is_manager(), public.escape_like(text) from public, anon;
grant execute on function public.today_local(), public.is_staff(), public.is_manager(), public.escape_like(text) to authenticated;
