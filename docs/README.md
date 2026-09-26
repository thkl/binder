# Project documentation

This folder contains the living documentation for the lightweight document management system.

## Documents

- [Product plan](./product-plan.md) — product vision, priorities, and milestones
- [Product boundaries](./product-boundaries.md) — what is in and out of the first release
- [Storage configuration](./architecture/storage.md) — original files, derived files, and configuration
- [Data access layer](./architecture/data-access.md) — where `basic-crud` fits and where it does not
- [Monorepo and contracts](./architecture/monorepo.md) — package boundaries and shared Zod API contracts
- [Backend feature modules](./architecture/backend-modules.md) — NestJS feature organization and dependency direction
- [Shared API infrastructure](./architecture/shared-api-infrastructure.md) — logging, throttling, guards, and cross-cutting providers
- [Client assets](./architecture/client-assets.md) — reuse plan for `ng_store` and `agrid`
- [Authentication and API](./architecture/authentication-and-api.md) — local login, optional OIDC, sessions, versioning, and endpoint conventions
- [OCR architecture](./architecture/ocr.md) — OCRmyPDF/Tesseract worker design
- [Document pipeline](./architecture/pipeline.md) — durable jobs, retries, events, and worker boundaries
- [Logging](./architecture/logging.md) — Winston logging, file rotation, and sensitive-data rules
- [Security baseline](./security.md) — continuous security checks and secure-by-default rules

## Documentation rules

- Record architectural and product decisions here before implementing them.
- Keep documents short and update them when behavior changes.
- Mark assumptions explicitly and replace them with decisions as the project evolves.
- Prefer documenting observable behavior and stable interfaces over implementation details.

## Current status

The project is in the planning phase. The first implementation milestone is defined, but no application code or database schema has been created yet.
