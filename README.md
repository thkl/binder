# Binder

Lightweight, self-hosted document management with filesystem originals, PostgreSQL metadata, asynchronous processing, and hybrid search.

## Workspace

```text
packages/
├── api/      # NestJS API and server-side application
├── client/   # Angular client
└── common/   # Zod contracts and shared types
```

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm build
pnpm dev
```

The API serves the built Angular client from `CLIENT_PATH` and exposes `GET /api/v1/health`. Database, authentication, document storage, and processing are intentionally the next implementation slices.

The PostgreSQL connection is configured through `DATABASE_URL`. Sequelize schema synchronization is disabled; feature models and explicit migrations will be added in the next database slice.

See [`docs/README.md`](./docs/README.md) for the product and architecture decisions.
