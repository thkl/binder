#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?Set BACKUP_FILE to a .dump file}"
: "${TARGET_DATABASE:?Set TARGET_DATABASE to the explicit restore target}"
: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=YES to continue}"

if [[ "$RESTORE_CONFIRM" != "YES" ]]; then
  echo "Restore cancelled: set RESTORE_CONFIRM=YES to confirm the target database." >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file does not exist: $BACKUP_FILE" >&2
  exit 1
fi

if [[ "${ALLOW_LIVE_RESTORE:-NO}" != "YES" && "$TARGET_DATABASE" == "${DATABASE_NAME:-}" ]]; then
  echo "Refusing to restore into DATABASE_NAME. Choose an empty target database or set ALLOW_LIVE_RESTORE=YES explicitly." >&2
  exit 1
fi

echo "Restoring $BACKUP_FILE into database $TARGET_DATABASE on ${DATABASE_HOST:-localhost}:${DATABASE_PORT:-5432}."
echo "Stop Binder API and worker before continuing."

pg_restore \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --host "${DATABASE_HOST:-localhost}" \
  --port "${DATABASE_PORT:-5432}" \
  --username "${DATABASE_USER:-binder}" \
  --dbname "$TARGET_DATABASE" \
  "$BACKUP_FILE"

echo "Restore completed. Start Binder with DATABASE_AUTOMIGRATE=true, run the health check, and verify document storage before normal use."
