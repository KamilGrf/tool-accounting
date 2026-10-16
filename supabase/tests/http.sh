#!/usr/bin/env bash
# Runs the real frontend API layer (src/api/index.js) against PostgREST (the REST layer Supabase uses)
# on a throw-away PostgreSQL 16 with the migrations and the demo data. Needs Docker and Node.
# Supabase Auth is not part of this check (the test signs its own JWTs): sign-in itself is covered by mocks.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT="$HERE/../../frontend"
NET="tools-http-net"; DB="tools-http-db"; REST="tools-http-rest"
PSQL=(docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q)
SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

cleanup() { docker rm -f "$REST" "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
for _ in $(seq 1 60); do echo 'select 1' | "${PSQL[@]}" >/dev/null 2>&1 && break; sleep 1; done

"${PSQL[@]}" < "$HERE/auth_stub.sql"
for f in "$HERE"/../migrations/*.sql; do "${PSQL[@]}" < "$f"; done
"${PSQL[@]}" < "$HERE/../seed.sql" >/dev/null
# Two signed-in users the test impersonates (ids are fixed in postgrest.test.js).
"${PSQL[@]}" -c "insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1', 'keeper@test'), ('00000000-0000-0000-0000-0000000000b1', 'boss@test'); update public.profiles set role = 'manager' where email = 'boss@test';"

docker run -d --name "$REST" --network "$NET" -p 127.0.0.1:3100:3000 \
    -e PGRST_DB_URI="postgres://authenticator:test@$DB:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_JWT_SECRET="$SECRET" \
    postgrest/postgrest:v12.2.3 >/dev/null
for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/ || true)"
    [ "$code" != "000" ] && break
    sleep 1
done
echo "PostgREST answers with HTTP $code"

cd "$FRONT"
POSTGREST_URL="http://127.0.0.1:3100" POSTGREST_JWT_SECRET="$SECRET" npx vitest run src/api/postgrest.test.js
