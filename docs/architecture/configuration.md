# Configuration ownership

Binder has a small bootstrap environment and a database-backed runtime configuration.

## Environment/bootstrap values

These values are required before the database settings can be read:

- PostgreSQL connection credentials
- `APP_ROOT_PATH`
- `ENCRYPTION_KEY`
- `SESSION_SECRET`
- `NODE_ENV`
- `API_PORT`
- `ROOT_URI` for the initial CORS policy

The client path is derived from `APP_ROOT_PATH` as `<APP_ROOT_PATH>/client`.

## Database settings

The following settings are seeded into the `settings` table and managed through the Settings UI:

- `documents.storageRoot`
- `documents.maxUploadBytes`
- `pipeline.pollIntervalMs`
- `pipeline.lockTimeoutMs`
- `pipeline.reconcileIntervalMs`
- OIDC settings

The API uses safe defaults when a runtime setting is not present. The worker loads the runtime values after connecting to PostgreSQL. Relative storage paths are resolved against `APP_ROOT_PATH`, which keeps the API and worker on the same shared storage path in containers.
