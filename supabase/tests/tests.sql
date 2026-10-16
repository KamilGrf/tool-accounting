-- Database tests: run by run.sh on a throw-away PostgreSQL 16 after the migrations (see README).
-- Each check runs a statement as a given user (anon / storekeeper / manager) and records PASS/FAIL.
\set ON_ERROR_STOP on
\pset pager off

create schema t;
create table t.results (id serial primary key, name text not null, ok boolean not null, detail text);

-- Run SQL as a user (null = anon) and return the first column of the first row as text,
-- or 'ERR:<sqlstate>|<message>' when it fails. SET LOCAL ROLE is undone by the exception block.
create function t.q(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_out text;
begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
    execute 'set local role ' || case when p_user is null then 'anon' else 'authenticated' end;
    execute p_sql into v_out;
    reset role;
    return v_out;
exception when others then
    reset role;
    return 'ERR:' || sqlstate || '|' || sqlerrm;
end $$;

create function t.eq(p_name text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
    insert into t.results(name, ok, detail)
    values (p_name, p_actual is not distinct from p_expected, 'expected [' || coalesce(p_expected, 'NULL') || '] got [' || coalesce(p_actual, 'NULL') || ']');
end $$;

-- Expect an error with this SQLSTATE and (optionally) a message fragment.
create function t.err(p_name text, p_actual text, p_state text, p_part text default '') returns void language plpgsql as $$
begin
    insert into t.results(name, ok, detail)
    values (p_name, coalesce(p_actual like 'ERR:' || p_state || '|%' and p_actual like '%' || p_part || '%', false), 'expected error ' || p_state || ' [' || p_part || '] got [' || coalesce(p_actual, 'NULL') || ']');
end $$;

-- ------------------------------------------------------------------ fixtures (superuser)
\o /dev/null
\set keeper  '''00000000-0000-0000-0000-0000000000a1'''
\set keeper2 '''00000000-0000-0000-0000-0000000000a2'''
\set boss    '''00000000-0000-0000-0000-0000000000b1'''

\set newbie '''00000000-0000-0000-0000-0000000000c1'''
insert into auth.users(id, email, email_confirmed_at) values (:keeper::uuid, 'keeper@test', now()), (:keeper2::uuid, 'keeper2@test', now()), (:boss::uuid, 'boss@test', now()), (:newbie::uuid, 'newbie@test', null);
-- New accounts are "pending"; the fixtures approve the staff the tests need (the newbie stays pending).
update public.profiles set role = 'manager' where id = :boss::uuid;
update public.profiles set role = 'storekeeper' where id in (:keeper::uuid, :keeper2::uuid);

insert into public.categories(name) values ('Электро'), ('Ручной');
insert into public.employees(full_name, department) values ('Иванов Пётр', 'Цех'), ('Петров Олег', 'Склад');
select set_config('app.internal_status_change', 'on', false);   -- fixtures set statuses directly
insert into public.tools(inv_number, name, category_id, status) values
    ('T-1', 'Дрель ударная', 1, 'in_stock'),
    ('T-2', 'Пила', 1, 'in_stock'),
    ('T-3', 'Молоток', 2, 'repair'),
    ('T-4', 'Старая лопата', 2, 'written_off'),
    ('T-5', 'Уровень 100% и_икс', 2, 'in_stock'),
    ('T-6', 'Без истории', 2, 'in_stock');
select set_config('app.internal_status_change', 'off', false);
select id as t1 from public.tools where inv_number = 'T-1' \gset
select id as t2 from public.tools where inv_number = 'T-2' \gset
select id as t3 from public.tools where inv_number = 'T-3' \gset
select id as t4 from public.tools where inv_number = 'T-4' \gset
select id as t6 from public.tools where inv_number = 'T-6' \gset
select id as e1 from public.employees where full_name = 'Иванов Пётр' \gset

-- ------------------------------------------------------------------ roles and profiles
select t.eq('an approved storekeeper has the storekeeper role', (select role from public.profiles where id = :keeper::uuid), 'storekeeper');
select t.eq('manager promoted by SQL', (select role from public.profiles where id = :boss::uuid), 'manager');
select t.eq('profile keeps the e-mail', (select email from public.profiles where id = :keeper::uuid), 'keeper@test');
select t.eq('a user sees only his own profile', t.q(:keeper::uuid, 'select count(*) from public.profiles'), '1');
select t.err('a storekeeper cannot promote himself', t.q(:keeper::uuid, format($q$with r as (update public.profiles set role = 'manager' where id = %L returning 1) select count(*) from r$q$, :keeper)), '42501');
select t.err('nobody can insert a profile', t.q(:keeper::uuid, format($q$insert into public.profiles(id, email, role) values (gen_random_uuid(), 'x@x', 'manager') returning 1$q$)), '42501');

-- ------------------------------------------------------------------ anonymous access is denied everywhere
select t.err('anon cannot read tools', t.q(null, 'select count(*) from public.v_tools'), '42501');
select t.err('anon cannot read tables', t.q(null, 'select count(*) from public.tools'), '42501');
select t.err('anon cannot call list_tools', t.q(null, 'select count(*) from public.list_tools()'), '42501');
select t.err('anon cannot issue a tool', t.q(null, format('select (public.issue_tool(%s, %s, current_date + 3)).id', :t1, :e1)), '42501');
select t.err('anon cannot read reports', t.q(null, 'select public.report_stats()::text'), '42501');

-- ------------------------------------------------------------------ catalogue: reading and searching
select t.eq('storekeeper reads all tools', t.q(:keeper::uuid, 'select count(*) from public.list_tools()'), '6');
select t.eq('search ignores case (Cyrillic)', t.q(:keeper::uuid, $q$select count(*) from public.list_tools('ДРЕЛЬ')$q$), '1');
select t.eq('search by inventory number', t.q(:keeper::uuid, $q$select count(*) from public.list_tools('t-3')$q$), '1');
select t.eq('percent sign is matched literally', t.q(:keeper::uuid, $q$select count(*) from public.list_tools('%')$q$), '1');
select t.eq('underscore is matched literally', t.q(:keeper::uuid, $q$select count(*) from public.list_tools('_')$q$), '1');
select t.eq('filter by status', t.q(:keeper::uuid, $q$select count(*) from public.list_tools(null, null, 'repair')$q$), '1');
select t.eq('filter by category', t.q(:keeper::uuid, 'select count(*) from public.list_tools(null, 1, null)'), '2');
select t.err('unknown status filter is rejected', t.q(:keeper::uuid, $q$select count(*) from public.list_tools(null, null, 'broken')$q$), 'P0400', 'Неизвестный статус');
select t.eq('categories view shows the tool counts', t.q(:keeper::uuid, $q$select tools_count from public.v_categories where name = 'Электро'$q$), '2');

-- ------------------------------------------------------------------ catalogue: writing
select t.eq('storekeeper adds a tool', t.q(:keeper::uuid, $q$with r as (insert into public.tools(inv_number, name, category_id, price) values ('T-7', 'Новый', 1, 100) returning 1) select count(*) from r$q$), '1');
select t.err('inventory number is unique ignoring case', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id) values ('t-7', 'Дубль', 1) returning 1$q$), '23505', 'ux_tools_inv_number');
select t.err('empty name is rejected', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id) values ('T-8', '', 1) returning 1$q$), '23514');
select t.err('negative price is rejected', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id, price) values ('T-8', 'Цена', 1, -1) returning 1$q$), '23514');
select t.err('untrimmed inventory number is rejected', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id) values (' T-8', 'Пробел', 1) returning 1$q$), '23514');
select t.err('too long note is rejected', t.q(:keeper::uuid, format($q$insert into public.tools(inv_number, name, category_id, note) values ('T-8', 'Заметка', 1, %L) returning 1$q$, repeat('x', 301))), '23514');
select t.eq('storekeeper edits a tool', t.q(:keeper::uuid, format($q$with r as (update public.tools set name = 'Пила 2' where id = %s returning 1) select count(*) from r$q$, :t2)), '1');
select t.eq('a storekeeper cannot delete a tool (RLS)', t.q(:keeper::uuid, format('with r as (delete from public.tools where id = %s returning 1) select count(*) from r', :t6)), '0');
select t.eq('...and the tool is still there', (select count(*)::text from public.tools where id = :t6), '1');
select t.eq('a manager deletes a tool without history', t.q(:boss::uuid, format('with r as (delete from public.tools where id = %s returning 1) select count(*) from r', :t6)), '1');

-- ------------------------------------------------------------------ status rules
select t.err('status "issued" cannot be set by hand', t.q(:keeper::uuid, format($q$with r as (update public.tools set status = 'issued' where id = %s returning 1) select count(*) from r$q$, :t2)), 'P0409', 'только через выдачу');
select t.err('a storekeeper cannot write a tool off', t.q(:keeper::uuid, format($q$with r as (update public.tools set status = 'written_off' where id = %s returning 1) select count(*) from r$q$, :t2)), 'P0403');
select t.err('a storekeeper cannot restore a written-off tool', t.q(:keeper::uuid, format($q$with r as (update public.tools set status = 'in_stock' where id = %s returning 1) select count(*) from r$q$, :t4)), 'P0403');
select t.eq('a manager writes a tool off', t.q(:boss::uuid, format($q$with r as (update public.tools set status = 'written_off' where id = %s returning 1) select count(*) from r$q$, :t2)), '1');
select t.eq('a manager restores it', t.q(:boss::uuid, format($q$with r as (update public.tools set status = 'in_stock' where id = %s returning 1) select count(*) from r$q$, :t2)), '1');
select t.eq('a storekeeper may send a tool to repair', t.q(:keeper::uuid, format($q$with r as (update public.tools set status = 'repair' where id = %s returning 1) select count(*) from r$q$, :t2)), '1');
select t.eq('...and back to stock', t.q(:keeper::uuid, format($q$with r as (update public.tools set status = 'in_stock' where id = %s returning 1) select count(*) from r$q$, :t2)), '1');

-- ------------------------------------------------------------------ issuing
select t.err('clients cannot write issues directly', t.q(:keeper::uuid, format('insert into public.issues(tool_id, employee_id, issued_at, due_at) values (%s, %s, current_date, current_date + 1) returning 1', :t1, :e1)), '42501');
select t.eq('issue_tool succeeds and shows who issued (local part of the e-mail only)', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 5)).issued_by', :t1, :e1)), 'keeper');
select t.eq('...the tool becomes "issued"', (select status from public.tools where id = :t1), 'issued');
select t.err('an issued tool cannot be issued again', t.q(:keeper2::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 5)).id', :t1, :e1)), 'P0409', 'уже выдан');
select t.err('a tool in repair cannot be issued', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 5)).id', :t3, :e1)), 'P0409', 'находится в ремонте');
select t.err('a written-off tool cannot be issued', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 5)).id', :t4, :e1)), 'P0409', 'списан');
select t.err('due date before the issue date', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, public.today_local() - 1)).id', :t2, :e1)), 'P0400', 'раньше даты выдачи');
select t.err('due date is required', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, null)).id', :t2, :e1)), 'P0400', 'Срок возврата');
select t.err('unknown employee', t.q(:keeper::uuid, format('select (public.issue_tool(%s, 99999, public.today_local() + 1)).id', :t2)), 'P0404', 'Сотрудник не найден');
select t.err('unknown tool', t.q(:keeper::uuid, format('select (public.issue_tool(99999, %s, public.today_local() + 1)).id', :e1)), 'P0404', 'Инструмент не найден');
select t.eq('the issue is visible in the list', t.q(:keeper2::uuid, format('select count(*) from public.list_issues(true, false, null, %s)', :t1)), '1');
select id as i1 from public.issues where tool_id = :t1 and returned_at is null \gset

-- ------------------------------------------------------------------ extending
select t.eq('extend moves the due date', t.q(:keeper::uuid, format('select (public.extend_issue(%s, public.today_local() + 9)).due_at = public.today_local() + 9', :i1)), 'true');
select t.err('new due date must be later', t.q(:keeper::uuid, format('select (public.extend_issue(%s, public.today_local() + 9)).id', :i1)), 'P0400', 'позже текущего');
select t.err('unknown issue cannot be extended', t.q(:keeper::uuid, 'select (public.extend_issue(99999, public.today_local() + 30)).id'), 'P0404');

-- ------------------------------------------------------------------ returning
select t.err('too long return note', t.q(:keeper::uuid, format('select (public.return_tool(%s, %L)).id', :i1, repeat('x', 301))), 'P0400', 'длиннее 300');
select t.err('return date before the issue date', t.q(:keeper::uuid, format('select (public.return_tool(%s, null, false, public.today_local() - 30)).id', :i1)), 'P0400', 'раньше даты выдачи');
select t.eq('return puts the tool back to stock', t.q(:keeper::uuid, format('select (public.return_tool(%s, ''Всё хорошо'')).returned_at = public.today_local()', :i1)), 'true');
select t.eq('...status is in_stock', (select status from public.tools where id = :t1), 'in_stock');
select t.eq('...and the returner is recorded', (select (returned_by = :keeper::uuid)::text from public.issues where id = :i1), 'true');
select t.err('a returned issue cannot be returned twice', t.q(:keeper::uuid, format('select (public.return_tool(%s)).id', :i1)), 'P0409', 'уже возвращён');
select t.err('a returned issue cannot be extended', t.q(:keeper::uuid, format('select (public.extend_issue(%s, public.today_local() + 40)).id', :i1)), 'P0409', 'уже возвращён');
select t.err('unknown issue cannot be returned', t.q(:keeper::uuid, 'select (public.return_tool(99999)).id'), 'P0404');
select t.eq('a tool can be issued again after the return', t.q(:keeper2::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 2)).tool_id', :t1, :e1)), :'t1');
select id as i2 from public.issues where tool_id = :t1 and returned_at is null \gset
select t.eq('return to repair sets the status and the tool note', t.q(:keeper::uuid, format($q$select (public.return_tool(%s, 'Заменить патрон', true)).condition_note$q$, :i2)), 'Заменить патрон');
select t.eq('...status is repair', (select status from public.tools where id = :t1), 'repair');
select t.eq('...the tool note is set', (select note from public.tools where id = :t1), 'Заменить патрон');
select t.err('a tool with history cannot be deleted', t.q(:boss::uuid, format('with r as (delete from public.tools where id = %s returning 1) select count(*) from r', :t1)), '23503');
select t.err('an employee with history cannot be deleted', t.q(:keeper::uuid, format('with r as (delete from public.employees where id = %s returning 1) select count(*) from r', :e1)), '23503');

-- ------------------------------------------------------------------ overdue and reports
select set_config('app.internal_status_change', 'on', false);
insert into public.issues(tool_id, employee_id, issued_at, due_at) values (:t2, :e1, public.today_local() - 10, public.today_local() - 3);
update public.tools set status = 'issued' where id = :t2;
select set_config('app.internal_status_change', 'off', false);

select t.eq('an open issue past its due date is overdue', (select overdue::text from public.v_issues where tool_id = :t2), '1');
select t.eq('closed issues are never overdue', (select max(overdue)::text from public.v_issues where tool_id = :t1), '0');
select t.eq('overdue filter finds only the overdue issue', t.q(:keeper::uuid, 'select count(*) from public.list_issues(false, true, null, null)'), '1');
select t.eq('report: overdue count', t.q(:boss::uuid, $q$select (public.report_stats()->>'overdue')$q$), '1');
select t.eq('report: tools in stock', t.q(:boss::uuid, $q$select (public.report_stats()->'counts'->>'in_stock')$q$), '2');
select t.eq('report: written-off tools are not in the total', t.q(:boss::uuid, $q$select (public.report_stats()->>'total_tools')$q$), '5');
select t.eq('report: top employee holds the overdue tool', t.q(:boss::uuid, $q$select (public.report_stats()->'topEmployees'->0->>'n')$q$), '1');
select t.err('a storekeeper cannot read the statistics', t.q(:keeper::uuid, 'select public.report_stats()::text'), 'P0403');
select t.err('a storekeeper cannot read the usage report', t.q(:keeper::uuid, 'select count(*) from public.report_usage()'), 'P0403');
select t.eq('usage report: days on hand of an open issue', t.q(:boss::uuid, format('select days_in_use from public.report_usage() where tool_id = %s', :t2)), '10');
select t.eq('usage report: issues of a tool', t.q(:boss::uuid, format('select issues_count from public.report_usage() where tool_id = %s', :t1)), '2');
select t.eq('usage report skips written-off tools', t.q(:boss::uuid, format('select count(*) from public.report_usage() where tool_id = %s', :t4)), '0');
select t.err('usage report: unknown category', t.q(:boss::uuid, 'select count(*) from public.report_usage(99999)'), 'P0404');

-- ------------------------------------------------------------------ health probe
select t.eq('health is public: anon gets ok', t.q(null, $q$select (public.health()->>'ok')$q$), 'true');
select t.eq('health works for signed-in users too', t.q(:keeper::uuid, $q$select (public.health()->>'ok')$q$), 'true');
select t.eq('health returns the server time', t.q(null, $q$select (public.health() ? 'time')::text$q$), 'true');

-- ------------------------------------------------------------------ client log: closed table, guarded function
select t.err('anon cannot call log_client_event', t.q(null, $q$select public.log_client_event('error', 'x')::text$q$), '42501');
select t.err('the log table cannot be read directly', t.q(:keeper::uuid, 'select count(*) from public.client_logs'), '42501');
select t.err('the log table cannot be written directly', t.q(:keeper::uuid, $q$insert into public.client_logs(level, message) values ('info', 'x') returning 1$q$), '42501');
select t.err('anon cannot read the log table either', t.q(null, 'select count(*) from public.client_logs'), '42501');

select t.eq('a signed-in user can append an entry', t.q(:keeper::uuid, $q$select public.log_client_event('error', 'boom', '{"status": 500}'::jsonb, '/tools', 'abc1234')::text$q$), '');
select t.eq('...it is stored with the pseudonymous user id', (select (user_id = :keeper::uuid)::text from public.client_logs where message = 'boom'), 'true');
select t.eq('...and with route, release and context', (select (route = '/tools' and release = 'abc1234' and context->>'status' = '500')::text from public.client_logs where message = 'boom'), 'true');
select t.err('an unknown level is rejected', t.q(:keeper::uuid, $q$select public.log_client_event('fatal', 'x')::text$q$), 'P0400', 'уровень');
select t.err('an empty message is rejected', t.q(:keeper::uuid, $q$select public.log_client_event('info', '   ')::text$q$), 'P0400', 'Пустое');
select t.err('a context that is not an object is rejected', t.q(:keeper::uuid, $q$select public.log_client_event('info', 'x', '[1,2]'::jsonb)::text$q$), 'P0400', 'Контекст');
select t.err('a huge context is rejected', t.q(:keeper::uuid, format($q$select public.log_client_event('info', 'x', jsonb_build_object('a', %L))::text$q$, repeat('y', 5000))), 'P0400', 'Контекст');
select t.eq('a long message is accepted', t.q(:keeper::uuid, format($q$select public.log_client_event('warn', %L)::text$q$, repeat('z', 800))), '');
select t.eq('...but stored cut to 500 characters', (select max(char_length(message))::text from public.client_logs where level = 'warn'), '500');

select t.eq('30 entries per minute are accepted', (select count(*) filter (where r like 'ERR:%')::text from (select t.q(:keeper2::uuid, $q$select public.log_client_event('info', 'spam')::text$q$) as r from generate_series(1, 30)) x), '0');
select t.err('the 31st entry within a minute is refused', t.q(:keeper2::uuid, $q$select public.log_client_event('info', 'spam')::text$q$), 'P0429', 'Слишком много');
select t.eq('the limit is per user: another user is not affected', t.q(:keeper::uuid, $q$select public.log_client_event('info', 'still fine')::text$q$), '');

-- ------------------------------------------------------------------ client log: reading and retention (managers only)
select t.err('a storekeeper cannot read the log', t.q(:keeper::uuid, 'select count(*) from public.list_client_logs()'), 'P0403');
select t.eq('a manager reads the log', t.q(:boss::uuid, $q$select (count(*) > 0)::text from public.list_client_logs()$q$), 'true');
select t.eq('the level filter works', t.q(:boss::uuid, $q$select count(*) from public.list_client_logs('error')$q$), '1');
select t.eq('the newest entries come first', t.q(:boss::uuid, $q$select message from public.list_client_logs(null, 1)$q$), 'still fine');
select t.eq('the limit is at least 1', t.q(:boss::uuid, $q$select count(*) from public.list_client_logs(null, 0)$q$), '1');
select t.err('a storekeeper cannot purge the log', t.q(:keeper::uuid, 'select public.purge_client_logs(30)::text'), 'P0403');
insert into public.client_logs(level, message, created_at) values ('info', 'ancient entry', now() - interval '40 days');
select t.eq('purge removes only entries older than the limit', t.q(:boss::uuid, 'select public.purge_client_logs(30)::text'), '1');
select t.eq('...recent entries stay', t.q(:boss::uuid, $q$select (count(*) > 0)::text from public.list_client_logs()$q$), 'true');


-- ------------------------------------------------------------------ access approval (security audit, migration 007)
select t.eq('a new Auth user waits for approval (role pending)', (select role from public.profiles where id = :newbie::uuid), 'pending');
select t.eq('...a pending user sees no tools', t.q(:newbie::uuid, 'select count(*) from public.v_tools'), '0');
select t.eq('...no employees', t.q(:newbie::uuid, 'select count(*) from public.v_employees'), '0');
select t.eq('...no issues', t.q(:newbie::uuid, 'select count(*) from public.v_issues'), '0');
select t.eq('...no search results', t.q(:newbie::uuid, 'select count(*) from public.list_tools()'), '0');
select t.err('...cannot add a tool (row security)', t.q(:newbie::uuid, $q$insert into public.tools(inv_number, name, category_id) values ('P-1', 'Нельзя', 1) returning 1$q$), '42501');
select t.err('...cannot issue a tool', t.q(:newbie::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 3)).id', :t2, :e1)), 'P0401');
select t.err('...cannot write to the log', t.q(:newbie::uuid, $q$select public.log_client_event('info', 'x')::text$q$), 'P0401');
select t.eq('...but still reads its own profile', t.q(:newbie::uuid, 'select role from public.profiles'), 'pending');

select t.err('a storekeeper cannot list users', t.q(:keeper::uuid, 'select count(*) from public.list_users()'), 'P0403');
select t.err('a storekeeper cannot set roles', t.q(:keeper::uuid, format($q$select public.set_user_role(%L::uuid, 'storekeeper')::text$q$, :newbie)), 'P0403');
select t.eq('a manager lists the users, pending first', t.q(:boss::uuid, 'select role from public.list_users() limit 1'), 'pending');
select t.eq('...all of them', t.q(:boss::uuid, 'select count(*) from public.list_users()'), '4');
select t.err('a role must be known', t.q(:boss::uuid, format($q$select public.set_user_role(%L::uuid, 'owner')::text$q$, :newbie)), 'P0400', 'роль');
select t.err('a manager cannot change his own role', t.q(:boss::uuid, format($q$select public.set_user_role(%L::uuid, 'storekeeper')::text$q$, :boss)), 'P0409', 'собственную');
select t.err('an unknown user cannot get a role', t.q(:boss::uuid, $q$select public.set_user_role('00000000-0000-0000-0000-00000000ffff'::uuid, 'storekeeper')::text$q$), 'P0404');
select t.eq('a manager approves the pending user', t.q(:boss::uuid, format($q$select public.set_user_role(%L::uuid, 'storekeeper')::text$q$, :newbie)), '');
select t.eq('...who then reads the catalogue', t.q(:newbie::uuid, 'select (count(*) > 0)::text from public.v_tools'), 'true');
select t.eq('...and the change is journaled with who did it', (select count(*)::text from public.audit_log where action = 'role_changed' and details->>'from' = 'pending' and details->>'to' = 'storekeeper' and actor = :boss::uuid and target = :newbie::uuid), '1');
select t.eq('a manager can send the user back to waiting', t.q(:boss::uuid, format($q$select public.set_user_role(%L::uuid, 'pending')::text$q$, :newbie)), '');
select t.eq('...who loses access at once', t.q(:newbie::uuid, 'select count(*) from public.v_tools'), '0');
select t.eq('the e-mail of whoever issued a tool is never handed out', (select count(*)::text from public.v_issues where issued_by like '%@%'), '0');

-- ------------------------------------------------------------------ audit hardening (migration 008)
select t.err('a tool cannot be created as issued', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id, status) values ('H-1', 'Сразу выдан', 1, 'issued') returning 1$q$), '42501');
select t.err('...nor as written off', t.q(:keeper::uuid, $q$insert into public.tools(inv_number, name, category_id, status) values ('H-2', 'Сразу списан', 1, 'written_off') returning 1$q$), '42501');
select t.eq('...but in stock it is fine', t.q(:keeper::uuid, $q$with r as (insert into public.tools(inv_number, name, category_id, status) values ('H-3', 'Обычный', 1, 'in_stock') returning 1) select count(*) from r$q$), '1');
select t.eq('a storekeeper cannot delete an employee (RLS)', t.q(:keeper::uuid, 'with r as (delete from public.employees where id = 2 returning 1) select count(*) from r'), '0');
select t.eq('a storekeeper cannot delete a category (RLS)', t.q(:keeper::uuid, 'with r as (delete from public.categories where id = 2 returning 1) select count(*) from r'), '0');
select t.eq('a manager can delete a category without tools', t.q(:boss::uuid, $q$with c as (insert into public.categories(name) values ('Временная') returning id), r as (delete from public.categories where id = (select id from c) returning 1) select count(*) from r$q$), '1');

select t.eq('list_users tells whether the e-mail is confirmed', t.q(:boss::uuid, $q$select string_agg(email || '=' || email_confirmed, ',' order by email) from public.list_users() where email in ('boss@test', 'newbie@test')$q$), 'boss@test=true,newbie@test=false');
select t.err('the audit table cannot be read directly', t.q(:boss::uuid, 'select count(*) from public.audit_log'), '42501');
select t.err('...nor written', t.q(:boss::uuid, $q$insert into public.audit_log(action) values ('forged') returning 1$q$), '42501');
select t.err('a storekeeper cannot read the audit log', t.q(:keeper::uuid, 'select count(*) from public.list_audit_log()'), 'P0403');
select t.eq('a manager reads the audit log, newest first', t.q(:boss::uuid, 'select details->>$$to$$ from public.list_audit_log()'), 'pending');
select t.eq('a role change is not left in the client journal any more', (select count(*)::text from public.client_logs where message = 'role_changed'), '0');
select t.eq('the audit log is kept apart from the purgeable client journal', (select (count(*) > 0)::text from public.audit_log), 'true');

insert into public.client_logs(level, message, user_id, created_at)
select 'info', 'old', :boss::uuid, now() - interval '2 hours' from generate_series(1, 500);
select t.err('more than 500 journal entries a day are refused', t.q(:boss::uuid, $q$select public.log_client_event('info', 'x')::text$q$), 'P0429', 'Дневной');
select t.eq('...for that user only', t.q(:keeper::uuid, $q$select public.log_client_event('info', 'fine')::text$q$), '');

select t.err('a return date more than a year ahead is refused', t.q(:keeper::uuid, format('select (public.issue_tool(%s, %s, public.today_local() + 400)).id', :t2, :e1)), 'P0400', 'через год');
select t.err('...even in the year 9999', t.q(:keeper::uuid, format($q$select (public.issue_tool(%s, %s, '9999-12-31'::date)).id$q$, :t2, :e1)), 'P0400', 'через год');
select t.err('extending beyond a year from the issue date is refused', t.q(:keeper::uuid, format('select (public.extend_issue(%s, public.today_local() + 400)).id', :i1)), 'P0400', 'через год');
select t.eq('extending within a year is fine', t.q(:keeper::uuid, format('select (public.extend_issue(%s, public.today_local() + 300)).due_at = public.today_local() + 300', :i1)), 'true');

-- ------------------------------------------------------------------ result
\o
select id, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;

do $$
begin
    if exists (select 1 from t.results where not ok) then
        raise exception 'SQL tests failed: % check(s)', (select count(*) from t.results where not ok);
    end if;
end $$;
