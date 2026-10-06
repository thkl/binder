# Binder setup guide

This guide covers a first installation of Binder with PostgreSQL. It applies
to Docker Compose and to a local API/worker development setup. The API runs
the versioned SQL migrations at startup, so the configured database role must
be able to create and change the Binder schema.

## Prerequisites

Choose one deployment shape:

- **Docker Compose:** Docker with Compose support. The included PostgreSQL
  service uses `pgvector/pgvector:pg17`.
- **External PostgreSQL:** PostgreSQL 17 is recommended, with the matching
  `vector` extension installed on the server.
- **Local development:** Node.js, pnpm, a reachable PostgreSQL instance, and
  the repository dependencies installed with `pnpm install`.

The API and worker must use the same PostgreSQL database and document storage
root. The worker also needs access to derived files and the backup directory.

## 1. Create a dedicated PostgreSQL database

Use a dedicated login role and database. Do not use the PostgreSQL `postgres`
superuser for Binder. Run the following as a PostgreSQL administrator on the
actual server that accepts the Binder connection:

```sql
CREATE ROLE binder LOGIN;
```

Set the password interactively in `psql`, so it does not appear in shell
history:

```text
\password binder
```

Then create the database owned by that role and connect to it:

```sql
CREATE DATABASE binder OWNER binder;
```

```text
\connect binder
```

Binder's current migration design uses the configured application role for
DDL. Grant it connection and schema privileges explicitly, even when it is
the database owner:

```sql
GRANT CONNECT ON DATABASE binder TO binder;
GRANT USAGE, CREATE ON SCHEMA public TO binder;
```

If the role or database already exists, do not recreate them. As the database
owner or an administrator, use the equivalent corrections instead:

```sql
ALTER DATABASE binder OWNER TO binder;
GRANT CONNECT ON DATABASE binder TO binder;

\connect binder
GRANT USAGE, CREATE ON SCHEMA public TO binder;
```

The `CREATE` privilege on `public` is important. Without it, the API can
connect successfully but the first migration fails with `permission denied
for schema public`.

### Verify the connection and permissions

Run this using the same host, database, and role that Binder will use.
Checking as `postgres` or against the `postgres` database is not sufficient:

```sql
SELECT
    current_user,
    current_database(),
    current_schema(),
    inet_server_addr(),
    has_schema_privilege(current_user, 'public', 'USAGE') AS can_use,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;

\dn+ public
```

Both `can_use` and `can_create` must be `t`. If the result differs between a
local and remote connection, apply the `GRANT` while connected to the target
database on the target PostgreSQL server, then run the check again.

## 2. Install and verify pgvector

Binder uses PostgreSQL vector storage for semantic document search. Confirm
that the extension is available and enabled in the Binder database:

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

If the query returns no row, install the PostgreSQL-17-compatible pgvector
package or provider image for your operating system first, then run:

```sql
-- Run this while connected to the Binder database as a PostgreSQL
-- administrator before starting the API for the first time.
CREATE EXTENSION IF NOT EXISTS vector;
```

Package names vary by distribution and PostgreSQL repository. The included
Compose service already uses `pgvector/pgvector:pg17`, so no host package is
needed for that deployment. For an external server, verify the extension
against the exact PostgreSQL major version; do not install a PostgreSQL-15
extension for a PostgreSQL-17 server.

Migration `V015__add_pgvector_embeddings.sql` also contains this
`CREATE EXTENSION IF NOT EXISTS` statement. Pre-creating the extension as an
administrator avoids requiring the application role to have extension
installation privileges; the application role still must have the normal
schema permissions described above.

## 3. Configure the environment

Create a private environment file from the template:

```bash
cp .env.example .env
```

Edit `.env` and replace every placeholder. At minimum, configure:

```dotenv
NODE_ENV=production
API_PORT=3000
API_PREFIX=api/v1
ROOT_URI=https://binder.example.com

APP_ROOT_PATH=/app
ENCRYPTION_KEY=<base64 encoding of exactly 32 random bytes>

DATABASE_HOST=db.example.com
DATABASE_PORT=5432
DATABASE_NAME=binder
DATABASE_USER=binder
DATABASE_PASSWORD=<the binder role password>
DATABASE_AUTOMIGRATE=true

SESSION_SECRET=<long random value>
SETUP_SECRET=<long random value used only for first-run setup>
```

For local development, `ROOT_URI` should match the browser origin, for
example `http://localhost:4200` when the Angular development server is used.
For Docker Compose, the service environment overrides `DATABASE_HOST` with
the internal hostname `postgres`; the other database values still come from
`.env`.

Generate secrets locally and paste them into the environment file or a secret
manager. Never commit `.env` or put real values in `.env.example`:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # SETUP_SECRET
```

`ENCRYPTION_KEY` must decode to exactly 32 bytes. Keep it stable after data
has been encrypted; changing it makes encrypted settings unreadable.

### Recovery secrets — keep both

Full recovery requires two different secrets, and having only one is not
enough:

1. `ENCRYPTION_KEY` is the Binder deployment key. It decrypts encrypted values
   stored in the restored PostgreSQL database, including Dropbox credentials
   and other protected settings. It must be the exact key from the original
   installation.
2. The backup encryption password is the passphrase configured as
   `backup.encryptionPassword`. It decrypts the `.tar.gz.age` backup archive
   and is entered separately during recovery. It is not the PostgreSQL
   password and is not stored in `.env`.

If either secret is missing, a full encrypted backup cannot be recovered. A
Dropbox connection or access token only provides access to the backup file; it
does not decrypt it.

## Secret environment variables and secret files

Binder accepts every server secret either as a normal environment variable or
through a matching `_FILE` variable. The direct value takes precedence; when
it is empty or unset, Binder reads the matching file, verifies that it is a
regular readable file, trims the contents, and caches the result for the
process lifetime.

For example, Docker or Kubernetes secret mounts can provide:

```env
DATABASE_PASSWORD_FILE=/run/secrets/database_password
ENCRYPTION_KEY_FILE=/run/secrets/encryption_key
SESSION_SECRET_FILE=/run/secrets/session_secret
SETUP_SECRET_FILE=/run/secrets/setup_secret
```

The files must be mounted into every container that needs the value. In the
standard deployment this means the API and worker both need database and
encryption secrets. Dropbox app credentials also support the same convention:
`DROPBOX_APP_KEY_FILE` and `DROPBOX_APP_SECRET_FILE`.

## 4. Start Binder with Docker Compose

The standard container deployment includes PostgreSQL with pgvector, ClamAV,
API, worker, shared document storage, logs, and backup storage:

```bash
docker compose build
docker compose up -d
docker compose logs -f api
```

On an empty PostgreSQL volume, the Compose init script creates the `vector`
extension, grants the configured role `USAGE` and `CREATE` on `public`, and
removes the initial superuser privileges from that role. The API and worker
then use the same role as a normal database owner/runtime role. PostgreSQL
init scripts run only when the data directory is initialized for the first
time.

The worker uses the ClamAV service through the internal Compose network. New
uploads and inbox imports remain in `scanning` until ClamAV returns a clean
result. A detected threat or unavailable required scanner moves the document
to `quarantined`; the original is not downloadable, previewable, searchable,
exportable, or available to AI processing in that state.

The worker must load `MALWARE_SCAN_CONFIG_FILE=/app/clamdscan.conf`, which is
provided by the standard Compose service. That file selects TCP transport to
the `clamav` service on port `3310`; a `LocalSocket` error means the running
worker has not loaded the Compose config and must be rebuilt/restarted.

The API is served on the Docker host port configured by `BINDER_HOST_PORT`
(`3000` by default). PostgreSQL is intentionally not published to the host by
the default Compose file. Inspect it from inside the container when needed:

```bash
docker compose exec postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### One-command bootstrap

The repository includes `scripts/setup.sh` for a new Compose installation:

```bash
./scripts/setup.sh
```

The script copies `.env.example` to `.env` when needed, generates missing
values for `DATABASE_PASSWORD`, `ENCRYPTION_KEY`, `SESSION_SECRET`, and
`SETUP_SECRET`, protects the file with mode `600`, validates the Compose
configuration, builds the images, and starts the stack. Compose interpolation
then supplies the same database name, role, and generated password to the
PostgreSQL, API, and worker containers.

Before starting the stack, it checks that `BINDER_HOST_PORT` is available and
detects the Docker host's primary local network address. The final message
prints the URL to use for the onboarding screen instead of defaulting to
`localhost`. For a fresh local setup, the script also updates a default local
`ROOT_URI` to the detected address so the API's CORS and CSRF checks accept
the browser URL. A custom non-local `ROOT_URI`, such as a reverse-proxy URL,
is preserved.

On a fresh installation, the script asks where document storage should live.
The default is the named Docker volume `binder-document-storage`. The host/NAS
option accepts an absolute path such as `/mnt/documents` and bind-mounts it at
`/app/storage` for both the API and worker. The selection is written to
`BINDER_DOCUMENTS_PATH` in `.env` and is preserved on later runs. The document
storage path is separate from the PostgreSQL and backup volumes.

For recovery of an existing installation, run the script interactively and
choose **Recovery**, or set the mode explicitly:

```bash
BINDER_SETUP_MODE=recovery ./scripts/setup.sh
```

Recovery mode preserves the existing `ENCRYPTION_KEY`, which must match the
key that encrypted Binder's stored settings. If the PostgreSQL database is
being recreated, the script can generate a new `DATABASE_PASSWORD`; if an
existing PostgreSQL volume is reused, enter its current password instead.
Dropbox app credentials are optional because recovery can use a one-time
Dropbox access token. Keep the existing document-storage and PostgreSQL
volumes attached when reusing them. Generating a new `ENCRYPTION_KEY` would
make encrypted settings, including the Dropbox refresh token, unreadable.

The backup encryption password is still mandatory for an encrypted full
backup. Enter it in the recovery wizard when the selected archive is
validated. The database password and backup encryption password are separate
values and must never be substituted for one another.

Configured values in an existing `.env` are preserved. Keep this file safe
and do not delete it while the PostgreSQL volume exists: PostgreSQL only uses
`POSTGRES_PASSWORD` when initializing a new data directory, so generating a
new password later would not change the password inside an existing database.
Use the normal Compose commands through the script when needed:

```bash
./scripts/setup.sh up -d
./scripts/setup.sh logs -f api
```

The script creates the database container and starts migrations; it does not
create the Binder administrator. At the end of the default installation flow,
it prints the generated one-time `SETUP_SECRET` so it can be entered in the
onboarding screen. Treat this value as sensitive and do not share or commit
it. It is not written to the application log.

If the PostgreSQL volume was created before this init script was added, apply
the runtime hardening once as a PostgreSQL administrator in the Binder
database:

```sql
ALTER ROLE binder
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO binder;
```

For NAS-backed storage, replace the named volume definitions with bind
mounts or a Compose override. The API and worker must see the same absolute
paths, and the mounted directories must allow the container user to read and
write documents, derived files, inbox files, logs, and backups. The import
and storage code intentionally uses group-friendly permissions (`770` for
directories and `660` for files) where the host filesystem supports them.

## 5. Start a local development instance

Install dependencies and build the shared contracts before starting the API:

```bash
pnpm install
pnpm build
pnpm --filter @binder/api dev
```

Start the worker in a second terminal when pipeline processing is needed:

```bash
pnpm --filter @binder/worker dev
```

Ensure the local environment points to the same database and storage paths
for both processes. `DATABASE_AUTOMIGRATE=true` lets the API apply pending
versioned SQL migrations. The worker does not own migrations; it waits for the
database and consumes the shared pipeline state.

Local worker development requires a reachable ClamAV/`clamdscan` command when
`security.malwareScan.required` is enabled. Disabling that setting is only an
explicit local-development exception and is visible in the worker log; it
should remain enabled for production.

## 6. Check migrations

On first startup, the API creates the migration version table and applies the
SQL files in `packages/api/migrations`. Check the API log for the applied
versions, then verify from the Binder database:

```sql
SELECT max(version) AS current_version FROM db_version;
\dt
```

Do not use Sequelize model synchronization as a substitute for migrations.
If the API reports that a relation does not exist, inspect the migration log
first and confirm that `DATABASE_AUTOMIGRATE=true` and the database role has
`public` schema `CREATE` permission.

## 7. Complete first-run onboarding

Open the configured `ROOT_URI`. When the database contains no users, Binder
shows the administrator setup screen. Enter:

1. the `SETUP_SECRET` from the deployment environment;
2. the administrator username;
3. a new administrator password and its confirmation.

The password is hashed immediately and is never logged. The API creates the
first administrator inside a transaction, establishes the normal Express
session, and disables the setup endpoint after success. Once the administrator
has been created, `SETUP_SECRET` can be removed from the runtime environment
or rotated according to the deployment's secret-management process.

The remaining storage, processing, AI, OIDC, and backup options are managed
from Application Settings. Do not put database credentials, encryption keys,
session secrets, or setup secrets into the database settings UI.

## Troubleshooting

### `permission denied for schema public`

The application reached PostgreSQL, but the role used by Binder cannot create
the migration tables. Connect to the exact database and grant:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO binder;
```

Re-run the verification query and check `current_user`,
`current_database()`, and `inet_server_addr()` so a different role, database,
or PostgreSQL host is not being inspected.

### `extension "vector" does not exist`

The extension is not installed for this PostgreSQL major version or has not
been created in the Binder database. Install the matching provider package or
use the included pgvector image, then run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### `relation ... does not exist`

Check the API migration log, `DATABASE_AUTOMIGRATE`, the selected database,
and the current migration version. The worker should not be started against a
different database than the API.

### The API starts but login setup is unavailable

Confirm that `SETUP_SECRET` is set in the API environment and that the setup
migration has been applied. The setup secret is deliberately not printed in
logs, so inspect the environment through the deployment's secret manager
rather than expecting it in the log output.

## Production checklist

- Use a dedicated non-superuser PostgreSQL role and a separate Binder database.
- Keep `DATABASE_PASSWORD`, `ENCRYPTION_KEY`, `SESSION_SECRET`, and
  `SETUP_SECRET` in a secret manager or protected environment file.
- Keep PostgreSQL off the public network unless it is required by the
  deployment; restrict access with the database firewall and network policy.
- Back up the PostgreSQL database and the document/derived storage together,
  and perform a restore drill before relying on the backup.
- Keep the API and worker on the same migration-compatible release and shared
  absolute storage paths.
- Configure `ROOT_URI` to the real browser origin when using HTTPS or a
  reverse proxy.
