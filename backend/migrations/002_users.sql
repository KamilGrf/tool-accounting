-- 002: users, roles and "who did it" columns (new in version 2, see ТЗ F6).

CREATE TABLE users (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login           text NOT NULL,
    password_hash   text NOT NULL,
    role            text NOT NULL CHECK (role IN ('storekeeper','manager')),
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_login ON users (lower(login));

ALTER TABLE issues
    ADD COLUMN issued_by   integer REFERENCES users(id),
    ADD COLUMN returned_by integer REFERENCES users(id);
