# Container deployment

The repository builds two runtime targets from the root `Dockerfile`:

- `api`: NestJS API serving the compiled Angular client from `/app/client`
- `worker`: standalone Sequelize/MuPDF pipeline worker

Both services share the same document storage volume and the same `/app/logs` volume. PostgreSQL is a separate service and the API remains responsible for migrations during startup.

On a new PostgreSQL volume, the Compose init script enables pgvector and
demotes the initial database role from superuser after granting the schema
permissions required by Binder migrations. Existing volumes are not rerun by
PostgreSQL init scripts; see the [setup guide](../setup.md) for the one-time
hardening command.

For the complete PostgreSQL provisioning, permissions, pgvector, environment,
onboarding, and troubleshooting procedure, see the [setup guide](../setup.md).

Build and start the complete local container stack with:

```bash
docker compose build
docker compose up -d
```

For a new installation, `./scripts/setup.sh` can generate the missing local
secrets, protect `.env`, validate the Compose configuration, build the images,
and start the stack. See the [setup guide](../setup.md) for the credential
initialization behavior and existing-volume warning.

The API is available at `http://localhost:3000`. Set production secrets, `ROOT_URI`, and database credentials through `.env`; do not bake `.env` into the image.
