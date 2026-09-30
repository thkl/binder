# Configuration ownership

Binder has a small bootstrap environment and a database-backed runtime configuration.

See the [setup guide](../setup.md) for a complete first-install procedure,
including PostgreSQL role and schema permissions.

## Environment/bootstrap values

These values are required before the database settings can be read:

- PostgreSQL connection credentials
- `APP_ROOT_PATH`
- `ENCRYPTION_KEY`
- `SESSION_SECRET`
- `SETUP_SECRET` for first-run administrator onboarding
- `NODE_ENV`
- `API_PORT`
- `ROOT_URI` for the initial CORS policy

The client path is derived from `APP_ROOT_PATH` as `<APP_ROOT_PATH>/client`.

## Database settings

The following settings are seeded into the `settings` table and managed through the Settings UI:

- `documents.storageRoot`
- `backup.root`
- `maintenance.storageConsistency.enabled`
- `maintenance.storageConsistency.schedule`
- `documents.maxUploadBytes`
- `pipeline.pollIntervalMs`
- `pipeline.lockTimeoutMs`
- `pipeline.reconcileIntervalMs`
- `inbox.path` and the other inbox runtime settings
- OIDC settings

The API uses safe defaults when a runtime setting is not present. The worker loads the runtime values after connecting to PostgreSQL. Relative storage paths are resolved against `APP_ROOT_PATH`, which keeps the API and worker on the same shared storage path in containers.

The worker uses the database setting `backup.root` for PostgreSQL dump files.
It should normally be an absolute path such as `/app/backup`; relative values
remain supported and are resolved against `APP_ROOT_PATH` for compatibility.
`PG_DUMP_PATH` only overrides the `pg_dump` executable when needed. Backup
scheduling, retention, and destination are runtime settings in PostgreSQL.
Storage consistency checks are enabled by default and run daily at `03:00`
in the configured `maintenance.timezone`; both the enabled flag and the
five-field cron schedule can be changed in the maintenance settings.
