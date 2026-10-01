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

The API serves the built Angular client from `CLIENT_PATH` and exposes `GET /api/v1/health`.

## Implemented workflows

- Upload and process documents with filesystem-backed originals and PostgreSQL metadata.
- Search documents using extracted text and optional semantic ranking.
- Edit document metadata individually or in bulk, with preview, overwrite policies, and rollback through document history.
- Organize documents with owner-scoped virtual folders and export selected or filtered documents as ZIP archives.
- Optionally generate validated PDF/A-2b archive derivatives without replacing the original upload.

The PostgreSQL connection is configured through `DATABASE_URL`. Sequelize schema synchronization is disabled; feature models and explicit migrations will be added in the next database slice.

See [`docs/README.md`](./docs/README.md) for the product and architecture decisions.
