# Container deployment

The repository builds two runtime targets from the root `Dockerfile`:

- `api`: NestJS API serving the compiled Angular client from `/app/client`
- `worker`: standalone Sequelize/MuPDF pipeline worker

Both services share the same document storage volume and the same `/app/logs` volume. PostgreSQL is a separate service and the API remains responsible for migrations during startup.

Build and start the complete local container stack with:

```bash
docker compose build
docker compose up -d
```

The API is available at `http://localhost:3000`. Set production secrets, `ROOT_URI`, and database credentials through `.env`; do not bake `.env` into the image.
