-- 004: views, status guard, business functions and reports (ported from ДЗ6/backend/src/services.js).
-- Error contract (SQLSTATE -> HTTP-like status used by the frontend):
--   P0400 invalid input, P0401 not signed in, P0403 no permission, P0404 not found, P0409 conflict.
-- Messages are written for the user and are shown as-is.

-- ---------------------------------------------------------------- views (RLS of the caller applies)

create view public.v_tools with (security_invoker = true) as
select t.id, t.inv_number, t.name, t.category_id, c.name as category,
       t.manufacturer, t.purchase_date, t.price, t.status, t.location, t.note
from public.tools t
join public.categories c on c.id = t.category_id;

create view public.v_issues with (security_invoker = true) as
select i.id, i.tool_id, t.inv_number, t.name as tool_name,
       i.employee_id, e.full_name as employee_name, e.department,
       i.issued_at, i.due_at, i.returned_at, i.condition_note,
       i.issued_by_login as issued_by,
       case when i.returned_at is null and i.due_at < public.today_local() then 1 else 0 end as overdue
from public.issues i
join public.tools t on t.id = i.tool_id
join public.employees e on e.id = i.employee_id;

create view public.v_employees with (security_invoker = true) as
select e.id, e.full_name, e.position, e.department, e.phone,
       (select count(*)::integer from public.issues i where i.employee_id = e.id and i.returned_at is null) as active_issues
from public.employees e;

create view public.v_categories with (security_invoker = true) as
select c.id, c.name, count(t.id)::integer as tools_count
from public.categories c
left join public.tools t on t.category_id = c.id
group by c.id;

-- ---------------------------------------------------------------- status guard

-- "Issued" is changed only by issue_tool / return_tool (they raise the internal flag for their own UPDATE);
-- writing a tool off, or bringing it back, is for managers (same rules as the old PUT /api/tools/:id).
create function public.tools_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.status is distinct from old.status then
        if (old.status = 'issued' or new.status = 'issued')
           and coalesce(current_setting('app.internal_status_change', true), '') <> 'on' then
            raise exception 'Статус «Выдан» меняется только через выдачу и возврат инструмента' using errcode = 'P0409';
        end if;
        if (new.status = 'written_off' or old.status = 'written_off') and not public.is_manager() then
            raise exception 'Недостаточно прав' using errcode = 'P0403';
        end if;
    end if;
    return new;
end;
$$;

create trigger tools_guard_update
    before update on public.tools
    for each row execute function public.tools_guard_update();

-- ---------------------------------------------------------------- list functions (RLS of the caller applies)

create function public.list_tools(p_q text default null, p_category integer default null, p_status text default null)
returns setof public.v_tools
language plpgsql
stable
set search_path = ''
as $$
begin
    if coalesce(p_status, '') <> '' and p_status not in ('in_stock', 'issued', 'repair', 'written_off') then
        raise exception 'Неизвестный статус' using errcode = 'P0400';
    end if;
    return query
    select * from public.v_tools t
    where (coalesce(p_q, '') = ''
           or t.name ilike '%' || public.escape_like(p_q) || '%'
           or t.inv_number ilike '%' || public.escape_like(p_q) || '%'
           or t.manufacturer ilike '%' || public.escape_like(p_q) || '%')
      and (p_category is null or t.category_id = p_category)
      and (coalesce(p_status, '') = '' or t.status = p_status)
    order by t.inv_number;
end;
$$;

create function public.list_issues(p_active boolean default false, p_overdue boolean default false,
                                   p_employee integer default null, p_tool integer default null)
returns setof public.v_issues
language sql
stable
set search_path = ''
as $$
    select * from public.v_issues i
    where (not coalesce(p_active, false) or i.returned_at is null)
      and (not coalesce(p_overdue, false) or (i.returned_at is null and i.overdue = 1))
      and (p_employee is null or i.employee_id = p_employee)
      and (p_tool is null or i.tool_id = p_tool)
    order by i.issued_at desc, i.id desc
$$;

create function public.list_employees(p_q text default null)
returns setof public.v_employees
language sql
stable
set search_path = ''
as $$
    select * from public.v_employees e
    where coalesce(p_q, '') = ''
       or e.full_name ilike '%' || public.escape_like(p_q) || '%'
       or e.department ilike '%' || public.escape_like(p_q) || '%'
    order by e.full_name
$$;

-- ---------------------------------------------------------------- issue / return / extend

create function public.issue_tool(p_tool_id integer, p_employee_id integer, p_due_at date, p_issued_at date default null)
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

create function public.return_tool(p_issue_id integer, p_condition_note text default null,
                                   p_to_repair boolean default false, p_returned_at date default null)
returns public.v_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_issue    public.issues%rowtype;
    v_note     text := nullif(btrim(coalesce(p_condition_note, '')), '');
    v_returned date;
    v_result   public.v_issues;
begin
    if not public.is_staff() then
        raise exception 'Требуется вход' using errcode = 'P0401';
    end if;
    if v_note is not null and char_length(v_note) > 300 then
        raise exception 'Поле «Состояние при возврате» длиннее 300 символов' using errcode = 'P0400';
    end if;

    select * into v_issue from public.issues where id = p_issue_id for update;
    if not found then
        raise exception 'Запись о выдаче не найдена' using errcode = 'P0404';
    end if;
    if v_issue.returned_at is not null then
        raise exception 'Инструмент уже возвращён' using errcode = 'P0409';
    end if;
    v_returned := coalesce(p_returned_at, public.today_local());
    if v_returned < v_issue.issued_at then
        raise exception 'Дата возврата не может быть раньше даты выдачи' using errcode = 'P0400';
    end if;

    update public.issues
       set returned_at = v_returned, condition_note = v_note, returned_by = auth.uid()
     where id = p_issue_id;

    perform set_config('app.internal_status_change', 'on', true);
    update public.tools
       set status = case when coalesce(p_to_repair, false) then 'repair' else 'in_stock' end,
           note = coalesce(case when coalesce(p_to_repair, false) then v_note end, note)
     where id = v_issue.tool_id;
    perform set_config('app.internal_status_change', 'off', true);

    select * into v_result from public.v_issues where id = p_issue_id;
    return v_result;
end;
$$;

create function public.extend_issue(p_issue_id integer, p_due_at date)
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

    update public.issues set due_at = p_due_at where id = p_issue_id;
    select * into v_result from public.v_issues where id = p_issue_id;
    return v_result;
end;
$$;

-- ---------------------------------------------------------------- reports (managers only)

create function public.report_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_manager() then
        raise exception 'Недостаточно прав' using errcode = 'P0403';
    end if;
    return jsonb_build_object(
        'counts', (select jsonb_build_object(
                       'in_stock',    count(*) filter (where status = 'in_stock'),
                       'issued',      count(*) filter (where status = 'issued'),
                       'repair',      count(*) filter (where status = 'repair'),
                       'written_off', count(*) filter (where status = 'written_off'))
                   from public.tools),
        'overdue', (select count(*) from public.issues where returned_at is null and due_at < public.today_local()),
        'total_tools', (select count(*) from public.tools where status <> 'written_off'),
        'total_cost', (select coalesce(sum(price), 0) from public.tools where status <> 'written_off'),
        'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'n', x.n, 'cost', x.cost) order by x.name), '[]'::jsonb)
                       from (select c.name, count(t.id) as n, coalesce(sum(t.price), 0) as cost
                             from public.categories c
                             left join public.tools t on t.category_id = c.id and t.status <> 'written_off'
                             group by c.id) x),
        'topEmployees', (select coalesce(jsonb_agg(jsonb_build_object('full_name', y.full_name, 'n', y.n) order by y.n desc, y.full_name), '[]'::jsonb)
                         from (select e.full_name, count(*) as n
                               from public.issues i join public.employees e on e.id = i.employee_id
                               where i.returned_at is null
                               group by e.id
                               order by n desc, e.full_name
                               limit 5) y)
    );
end;
$$;

create function public.report_usage(p_category integer default null)
returns table (tool_id integer, inv_number text, tool_name text, category text,
               issues_count bigint, days_in_use bigint, last_issued_at date)
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
    if p_category is not null then
        perform 1 from public.categories c where c.id = p_category;
        if not found then
            raise exception 'Категория не найдена' using errcode = 'P0404';
        end if;
    end if;
    return query
    select t.id, t.inv_number, t.name, c.name,
           count(i.id),
           coalesce(sum(coalesce(i.returned_at, public.today_local()) - i.issued_at), 0)::bigint,
           max(i.issued_at)
    from public.tools t
    join public.categories c on c.id = t.category_id
    left join public.issues i on i.tool_id = t.id
    where t.status <> 'written_off' and (p_category is null or t.category_id = p_category)
    group by t.id, c.name
    order by 6 desc, t.inv_number;
end;
$$;

-- ---------------------------------------------------------------- privileges

revoke all on public.v_tools, public.v_issues, public.v_employees, public.v_categories from anon, authenticated;
grant select on public.v_tools, public.v_issues, public.v_employees, public.v_categories to authenticated;

revoke all on function
    public.tools_guard_update(),
    public.list_tools(text, integer, text),
    public.list_issues(boolean, boolean, integer, integer),
    public.list_employees(text),
    public.issue_tool(integer, integer, date, date),
    public.return_tool(integer, text, boolean, date),
    public.extend_issue(integer, date),
    public.report_stats(),
    public.report_usage(integer)
from public, anon;

grant execute on function
    public.tools_guard_update(),
    public.list_tools(text, integer, text),
    public.list_issues(boolean, boolean, integer, integer),
    public.list_employees(text),
    public.issue_tool(integer, integer, date, date),
    public.return_tool(integer, text, boolean, date),
    public.extend_issue(integer, date),
    public.report_stats(),
    public.report_usage(integer)
to authenticated;

notify pgrst, 'reload schema';
