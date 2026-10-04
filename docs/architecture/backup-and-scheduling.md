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

The `backup.scope` setting controls what is included:

- `database` creates a database-only backup. Without an encryption password it
  can remain a local plaintext pg_dump; with a password it is stored as an
  encrypted `.tar.gz.age` archive.
- `full` includes the PostgreSQL dump and the complete configured
  document-storage tree. Full backups always require `backup.encryptionPassword`
  so document files are never sent to an external provider unencrypted.

When `backup.encryptionPassword` is configured, the worker creates a
`.tar.gz.age` archive instead of retaining the plaintext dump. The archive is
standard age passphrase encryption around a gzip-compressed tar archive, so it
can be recovered with the normal `age` and `tar` tools. The password is only
stored encrypted at rest in Binder's settings; it is never sent to Dropbox or
written into the archive metadata.

For emergency recovery on a local machine:

```bash
age --decrypt -o backup.tar.gz binder-20261004-120000.tar.gz.age
tar -xzf backup.tar.gz
```

If you are using MacOS you can install the age tool via homebrew
```
brew install age
```

You will be prompted for the encryption password. The password was set in the binder
settings as `backup.encryptionPassword`

The output directory contains `database.dump`, `manifest.json`, and, for a
full backup, the `storage/` directory. Restore the database with `pg_restore`
and copy the storage tree to the configured Binder storage location.

External delivery is selected with `backup.provider` and
`backup.remoteFolder`. Dropbox uses an OAuth refresh token stored encrypted in
`backup.dropbox.refreshToken`; administrators connect it from Settings and do
not paste a token into the application. Uploads use provider upload sessions
for large bundles. A Dropbox connection cannot decrypt a backup; operators
must retain the encryption password separately. If no provider is selected,
the encrypted bundle remains in `backup.root` for the existing retention job.
When `backup.removeLocalAfterUpload` is enabled, the worker removes the local
encrypted artifact and its sidecar manifest only after the provider confirms a
successful upload. Remote backups are also included in retention cleanup; files
matching Binder backup names older than `backup.retentionDays` are deleted from
the configured provider folder.

## Configure the Dropbox application

The Dropbox app key and secret identify Binder's OAuth application. They are
server-side credentials and must never be committed to the repository or
entered into the Binder settings UI.

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps) and
   choose **Create app**.
2. Select **Scoped access**, then choose **Full Dropbox** or **App folder**.
   App folder is the safer choice if Binder should only access its own Dropbox
   folder.
3. Give the app the required files scopes: `files.content.read` and
   `files.content.write`. Save the permissions.
4. On the app's **Settings** page, copy **App key** and **App secret** into the
   server environment:

   ```env
   DROPBOX_APP_KEY=your-app-key
   DROPBOX_APP_SECRET=your-app-secret
   ```

   When the deployment injects Docker or Kubernetes secrets as files, use the
   optional file variables instead:

   ```env
   DROPBOX_APP_KEY_FILE=/run/secrets/api_dropbox_app_key
   DROPBOX_APP_SECRET_FILE=/run/secrets/api_dropbox_app_secret
   ```

   The same variables must be available to both the API and worker containers.
   A direct value is used first; the corresponding `_FILE` value is used when
   the direct variable is empty. Secret-file contents are trimmed and are not
   logged.

5. Add Binder's derived callback URL to **Redirect URIs** in the same Dropbox
   app. It is built from `ROOT_URI` and `API_PREFIX`:

   ```text
   {ROOT_URI}/{API_PREFIX}/maintenance/dropbox/callback
   ```

   With the default local configuration this is:

   ```text
   http://localhost:3000/api/v1/maintenance/dropbox/callback
   ```

   The URL must match exactly, including scheme, hostname, port, path, and
   trailing slash behavior. No `DROPBOX_REDIRECT_URI` setting is needed in
   Binder.

6. Restart the API and worker after setting the credentials. In Binder, open
   **Settings → Backup and maintenance → Dropbox connection** and choose
   **Connect Dropbox**. Dropbox will ask the administrator to authorize the
   requested file scopes; Binder stores only the resulting refresh token,
   encrypted with the application encryption key.

The backup job should also write a small manifest containing the dump version,
creation time, database identity, and application version. A later consistency
check can compare document storage keys and checksums with the NAS share
without copying the originals.

## Restore

Restore is an explicit operational action, not a normal HTTP endpoint. The
documented restore flow will:

1. stop API and worker consumers;
2. create or select an empty target database;
3. restore with pg_restore;
4. run migrations and consistency checks;
5. verify that the configured storage share contains the referenced originals;
6. start the services and verify health, authentication, and pipeline access.

Restore must require an explicit target database and confirmation so a normal
backup job cannot overwrite a live database accidentally. Restore tests belong
to the P2 hardening phase. The repository includes a guarded operator script at
`scripts/restore-database.sh`; it requires `BACKUP_FILE`, `TARGET_DATABASE`,
and `RESTORE_CONFIRM=YES`, and refuses to target the configured live database
unless `ALLOW_LIVE_RESTORE=YES` is explicitly supplied.

P3 onboarding may provide a guided version of this flow for catastrophic
recovery: connect Dropbox, inspect encrypted backup metadata, select a backup,
enter the backup password, and explicitly confirm replacement of the initial
database and document storage. This must remain a privileged, authenticated
setup action and retain the same guarded restore boundaries as the operator
script.

## Scheduler boundary

Recurring maintenance currently runs inside the persistent worker process,
separate from the API request process. The worker already owns database and
filesystem access, structured logging, and restart handling, so this keeps the
deployment small while the maintenance workload is light. Maintenance lives in
its own worker module and can later be moved to a second worker process or
container without changing the database or API contracts if backup and cleanup
jobs become expensive.

The worker maintenance loop will:

- load enabled job definitions and schedules from database settings;
- use an explicit timezone;
- prevent overlapping executions of the same job;
- persist the last run, next run, status, duration, and error;
- emit structured Winston logs and expose an admin-only status view;
- shut down cleanly and mark interrupted runs as failed for operator review.

The implemented scheduled jobs are:

- Database or full backup, depending on `backup.scope`
- backup retention cleanup
- document-storage consistency audit

Completed pipeline jobs and their technical job events are cleaned up after
`pipeline.jobRetentionDays` (10 days by default). This removes only pipeline
history; document audit events are retained separately.

The next maintenance jobs are planned as:

- temporary/derived-file cleanup after a configurable age

The backup destination is the database setting `backup.root` and should be an
absolute path such as `/app/backup`. This allows Docker to mount a dedicated
volume at that path without adding another destination environment variable.
Database connection and encryption-related bootstrap values remain deployment
configuration. Schedule, retention, and enabled state belong in runtime
settings once the database is available. A failed backup must be visible and
must not be treated as a successful maintenance run.

## Document-storage consistency audit

The worker can run a daily consistency audit using the setting keys
`maintenance.storageConsistency.enabled` and
`maintenance.storageConsistency.schedule`. It reads document records through
Sequelize, resolves each `storageKey` through the configured storage adapter,
and checks that the original is a regular file with the expected size and
SHA-256 checksum.

The audit stores one current issue per document in
`document_storage_issues`. Missing, unreadable, size-mismatched, and
checksum-mismatched files are kept as open issues and assigned to the document
owner. A later successful check resolves the issue without deleting its
history. Owners see their open issues above the document list; administrators
also see the checked-file and open-issue counts in the maintenance run list.

The audit intentionally does not scan arbitrary files in the storage tree.
The database is the source of truth for the expected document set, while
unreferenced files remain an operator or future cleanup concern. Checksums are
calculated only after the file exists and its size matches, which avoids a
second full read for the common size-mismatch case.
