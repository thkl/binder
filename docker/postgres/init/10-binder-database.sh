#!/usr/bin/env bash

set -Eeuo pipefail

# The official PostgreSQL image creates POSTGRES_USER as a superuser during
# initdb. Use that one-time privilege to prepare pgvector and then reduce the
# role to the permissions Binder actually needs at runtime.
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --no-password \
  -v binder_role="$POSTGRES_USER" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE, CREATE ON SCHEMA public TO :"binder_role";
ALTER ROLE :"binder_role"
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;
SQL
