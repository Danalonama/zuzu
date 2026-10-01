#!/bin/sh
# Applies every migration + seed to a throwaway database and runs the tests.
#   PGHOST=... PGPORT=... PGUSER=... sh v2/db/test/run.sh
# Needs Postgres 15+ with the pg_trgm extension available (Supabase has it).
set -eu
cd "$(dirname "$0")/.."
DB="${ZUZU_TEST_DB:-zuzu_test}"

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in migrations/*.sql seed/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
for f in test/*.sql; do
  echo "== $f"
  psql -X -q -t -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
echo "all tests passed"
