# Project documentation

This folder contains the living documentation for the lightweight document management system.

## Documents

- [Product plan](./product-plan.md) — product vision, priorities, and milestones
- [Product boundaries](./product-boundaries.md) — what is in and out of the first release
- [Storage configuration](./architecture/storage.md) — original files, derived files, and configuration
- [Inbox queue](./architecture/inbox.md) — durable import state, completion policy, live updates, and batch AI review
- [Data access layer](./architecture/data-access.md) — where `basic-crud` fits and where it does not
- [Monorepo and contracts](./architecture/monorepo.md) — package boundaries and shared Zod API contracts
- [Backend feature modules](./architecture/backend-modules.md) — NestJS feature organization and dependency direction
- [Shared API infrastructure](./architecture/shared-api-infrastructure.md) — logging, throttling, guards, and cross-cutting providers
- [Client assets](./architecture/client-assets.md) — reuse plan for `ng_store` and `agrid`
- [Authentication and API](./architecture/authentication-and-api.md) — local login, optional OIDC, sessions, versioning, and endpoint conventions
- [OCR architecture](./architecture/ocr.md) — OCRmyPDF/Tesseract worker design
- [PDF/A archives](./architecture/pdfa-archives.md) — validated archival derivatives and original-file preservation
- [Document audit history](./architecture/document-audit.md) — owner-visible document change history
- [First-run onboarding](./architecture/onboarding.md) — secure administrator creation and guided initial configuration
- [Document pipeline](./architecture/pipeline.md) — durable jobs, retries, events, and worker boundaries
- [Controlled document metadata](./architecture/document-metadata.md) — system and personal classification vocabularies
- [Issuers](./architecture/issuers.md) — reusable sender records, document references, and deterministic worker matching
- [Document search](./architecture/search.md) — page text search, snippets, and the semantic-search extension point
- [Document bulk actions](./architecture/bulk-actions.md) — page-scoped selection and batch document operations
- [Virtual folders](./architecture/virtual-folders.md) — owner-scoped logical folder trees and document links
- [Document exports](./architecture/document-exports.md) — selected-document and folder ZIP exports
- [Saved searches](./architecture/saved-searches.md) — owner-scoped reusable list and semantic searches
- [Backup and scheduled maintenance](./architecture/backup-and-scheduling.md) — PostgreSQL backup/restore, retention, and recurring jobs
- [Extensions and plugins](./architecture/extensions.md) — versioned extension points, calendar automation, and email import
- [iOS companion](./architecture/ios-companion.md) — Share Sheet ingestion, web UI hosting, and offline upload queueing
- [AI assistance](./architecture/ai-assistance.md) — user-confirmed hosted title suggestions
- [Localization](./architecture/localization.md) — extensible UI and vocabulary translations
- [Container deployment](./architecture/containers.md) — API, client, worker, PostgreSQL, and shared storage
- [Configuration ownership](./architecture/configuration.md) — bootstrap environment versus database runtime settings
- [Setup guide](./setup.md) — PostgreSQL provisioning, pgvector, environment configuration, migrations, and first-run setup
- [Logging](./architecture/logging.md) — Winston logging, file rotation, and sensitive-data rules
- [Security baseline](./security.md) — continuous security checks and secure-by-default rules

## Documentation rules

- Record architectural and product decisions here before implementing them.
- Keep documents short and update them when behavior changes.
- Mark assumptions explicitly and replace them with decisions as the project evolves.
- Prefer documenting observable behavior and stable interfaces over implementation details.

## Current status

P0, P1, and P2 are implemented. The inbox slice, bulk document actions, virtual folders, recursive ZIP exports, saved searches, backup scheduling, retention cleanup, visible status, manual backup requests, restore instructions, scheduled document-storage consistency checks, and the first administrator onboarding slice are in place. A real restore drill remains recommended as operational verification. P3 has started with administrator-managed AI provider profiles, independent assistant/embedding provider selection, file-aware PDF analysis, PostgreSQL-backed per-document audit history, bulk metadata editing with preview, overwrite confirmation, immutable change sets, guarded rollback, and PDF/A-2b archive derivatives. Email, scanner ingestion, password reset, and the Swift iOS companion remain in P3.
