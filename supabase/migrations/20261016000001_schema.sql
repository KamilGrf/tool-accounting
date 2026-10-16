-- 001: core schema (ported from the earlier Node.js + PostgreSQL version of the project).
-- Differences: users live in Supabase Auth (auth.users) + public.profiles; "who did it" columns are uuid;
-- text limits that the Node API checked in code are CHECK constraints here.

create table public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    email      text not null,
    -- The role is never taken from user input: the trigger in 002 always creates 'storekeeper',
    -- a manager is promoted by SQL (see README).
    role       text not null default 'storekeeper' check (role in ('storekeeper', 'manager')),
    created_at timestamptz not null default now()
);

create table public.categories (
    id   integer generated always as identity primary key,
    name text not null unique,
    constraint categories_name_chk check (name = btrim(name) and char_length(name) between 1 and 80)
);

create table public.tools (
    id            integer generated always as identity primary key,
    inv_number    text    not null,
    name          text    not null,
    category_id   integer not null references public.categories (id),
    manufacturer  text,
    purchase_date date,
    price         numeric(12, 2) not null default 0 check (price >= 0),
    status        text    not null default 'in_stock'
                  check (status in ('in_stock', 'issued', 'repair', 'written_off')),
    location      text,
    note          text,
    created_at    timestamptz not null default now(),
    constraint tools_inv_number_chk  check (inv_number = btrim(inv_number) and char_length(inv_number) between 1 and 30),
    constraint tools_name_chk        check (name = btrim(name) and char_length(name) between 1 and 120),
    constraint tools_manufacturer_chk check (manufacturer is null or char_length(manufacturer) <= 80),
    constraint tools_location_chk    check (location is null or char_length(location) <= 120),
    constraint tools_note_chk        check (note is null or char_length(note) <= 300)
);
create unique index ux_tools_inv_number on public.tools (lower(inv_number));
create index ix_tools_category on public.tools (category_id);
create index ix_tools_status on public.tools (status);

create table public.employees (
    id         integer generated always as identity primary key,
    full_name  text not null,
    position   text,
    department text,
    phone      text,
    constraint employees_full_name_chk  check (full_name = btrim(full_name) and char_length(full_name) between 1 and 120),
    constraint employees_position_chk   check (position is null or char_length(position) <= 80),
    constraint employees_department_chk check (department is null or char_length(department) <= 80),
    constraint employees_phone_chk      check (phone is null or char_length(phone) <= 30)
);

create table public.issues (
    id              integer generated always as identity primary key,
    tool_id         integer not null references public.tools (id),
    employee_id     integer not null references public.employees (id),
    issued_at       date    not null,
    due_at          date    not null,
    returned_at     date,
    condition_note  text,
    issued_by       uuid references public.profiles (id) on delete set null,
    -- Snapshot of the e-mail: shown in the UI without exposing other users' profiles.
    issued_by_login text,
    returned_by     uuid references public.profiles (id) on delete set null,
    created_at      timestamptz not null default now(),
    check (due_at >= issued_at),
    check (returned_at is null or returned_at >= issued_at),
    constraint issues_condition_note_chk check (condition_note is null or char_length(condition_note) <= 300)
);
-- One tool cannot be issued to two people at once (race-proof, enforced by the database).
create unique index ux_issues_open_tool on public.issues (tool_id) where returned_at is null;
create index ix_issues_employee on public.issues (employee_id);
create index ix_issues_tool on public.issues (tool_id);
create index ix_issues_open_due on public.issues (due_at) where returned_at is null;
create index ix_issues_issued_by on public.issues (issued_by);
create index ix_issues_returned_by on public.issues (returned_by);
