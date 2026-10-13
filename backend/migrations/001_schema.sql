-- 001: core schema (ported from the SQLite version in App/src/db.js).
-- Changes versus SQLite: DATE/NUMERIC/TIMESTAMPTZ instead of TEXT/REAL, identity keys,
-- case-insensitive unique inventory number, created_at audit column.

CREATE TABLE categories (
    id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE tools (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inv_number    text    NOT NULL,
    name          text    NOT NULL,
    category_id   integer NOT NULL REFERENCES categories(id),
    manufacturer  text,
    purchase_date date,
    price         numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    status        text    NOT NULL DEFAULT 'in_stock'
                  CHECK (status IN ('in_stock','issued','repair','written_off')),
    location      text,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_tools_inv_number ON tools (lower(inv_number));
CREATE INDEX ix_tools_category ON tools (category_id);
CREATE INDEX ix_tools_status ON tools (status);

CREATE TABLE employees (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name  text NOT NULL,
    position   text,
    department text,
    phone      text
);

CREATE TABLE issues (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tool_id        integer NOT NULL REFERENCES tools(id),
    employee_id    integer NOT NULL REFERENCES employees(id),
    issued_at      date    NOT NULL,
    due_at         date    NOT NULL,
    returned_at    date,
    condition_note text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (due_at >= issued_at),
    CHECK (returned_at IS NULL OR returned_at >= issued_at)
);
-- One tool cannot be issued to two people at once (race-proof, enforced by the database).
CREATE UNIQUE INDEX ux_issues_open_tool ON issues (tool_id) WHERE returned_at IS NULL;
CREATE INDEX ix_issues_employee ON issues (employee_id);
CREATE INDEX ix_issues_open_due ON issues (due_at) WHERE returned_at IS NULL;
