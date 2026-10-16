#!/usr/bin/env bash
# Runs the migrations and the SQL tests on a throw-away PostgreSQL 16 container (needs Docker).
# It does NOT touch Supabase: auth_stub.sql imitates the few Supabase parts the migrations rely on.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="tools-sql-test"
PSQL=(docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q)

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
for _ in $(seq 1 60); do
    docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
done
# The server restarts once during image initialisation: wait until a real query works.
for _ in $(seq 1 60); do
    echo 'select 1' | "${PSQL[@]}" >/dev/null 2>&1 && break
    sleep 1
done

"${PSQL[@]}" < "$HERE/auth_stub.sql"
for f in "$HERE"/../migrations/*.sql; do
    echo "migration: $(basename "$f")"
    "${PSQL[@]}" < "$f"
done
echo "seed.sql"
"${PSQL[@]}" < "$HERE/../seed.sql" > /dev/null
# Smoke-check the demo data, then empty the tables so the tests start from their own fixtures.
SEEDED="$("${PSQL[@]}" -At -c "select (select count(*) from public.tools) || ' tools, ' || (select count(*) from public.employees) || ' employees, ' || (select count(*) from public.issues) || ' issues, ' || (select count(*) from public.tools where status <> 'in_stock') || ' not in stock'")"
echo "seed loaded: $SEEDED"
[ "$SEEDED" = "14 tools, 5 employees, 3 issues, 3 not in stock" ] || { echo "unexpected seed result" >&2; exit 1; }
"${PSQL[@]}" -c "truncate public.issues, public.tools, public.employees, public.categories restart identity cascade"
echo "--- tests"
"${PSQL[@]}" -X < "$HERE/tests.sql"
