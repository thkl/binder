# Backup and scheduled maintenance

## Why this is P2

Binder keeps document binaries in configured filesystem storage, while the
document catalog, metadata, search indexes, pipeline state, users, and
settings live in PostgreSQL. In the current deployment the database is in a
Docker volume and the originals are on an NAS share. A database backup is
therefore required before the system is considered operationally safe.

Database backup does not replace backup of the NAS document share. A restored
database contains storage keys and metadata; the referenced originals and
derived files must still be available from the storage backup or the original
share.

## Backup format and scope

- Create a PostgreSQL logical dump with pg_dump in custom format.
- Include schema, migrations, users, settings, document metadata, pipeline
  state, extracted text, and embeddings.
- Write the dump to a temporary file and atomically rename it after success.
- Store backup files outside the PostgreSQL Docker volume, preferably on a
  separate mounted backup location.
- Restrict backup files to the service account and never expose them through
  the static client or document download endpoints.
- Log job start, completion, duration, size, destination, and failure reason;
  never log database passwords or dump contents.

The backup job should also write a small manifest containing the dump version,
creation time, database identity, and application version. A later consistency
check can compare document storage keys and checksums with the NAS share
without copying the originals.

## Restore

Restore is an explicit operational action, not a normal HTTP endpoint. The
documented restore flow will:

1. stop API, worker, and scheduler consumers;
2. create or select an empty target database;
3. restore with pg_restore;
4. run migrations and consistency checks;
5. verify that the configured storage share contains the referenced originals;
6. start the services and verify health, authentication, and pipeline access.

Restore must require an explicit target database and confirmation so a normal
backup job cannot overwrite a live database accidentally. Restore tests belong
to the P2 hardening phase.

## Scheduler boundary

Recurring maintenance must run in a dedicated scheduler process/container,
separate from the API request process and the pipeline worker. This prevents
an API restart or a busy OCR worker from silently disabling backups.

The scheduler will:

- load enabled job definitions and schedules from database settings;
- use an explicit timezone;
- prevent overlapping executions of the same job;
- persist the last run, next run, status, duration, and error;
- emit structured Winston logs and expose an admin-only status view;
- shut down cleanly and recover missed jobs according to each job policy.

The first scheduled jobs are:

- PostgreSQL backup
- backup retention cleanup
- temporary/derived-file cleanup after a configurable age
- document-storage consistency audit

Backup destination, database connection, and encryption-related deployment
values remain deployment configuration. Schedule, retention, enabled state, and
maintenance thresholds belong in runtime settings once the database is
available. A failed backup must be visible and must not be treated as a
successful maintenance run.
