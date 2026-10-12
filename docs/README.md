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
- [Document versions and page splitting](./architecture/document-versions.md) — planned non-destructive version families and PDF page extraction
- [First-run onboarding](./architecture/onboarding.md) — secure administrator creation and guided initial configuration
- [Document pipeline](./architecture/pipeline.md) — durable jobs, retries, events, and worker boundaries
- [API and worker test strategy](./architecture/testing.md) — Vitest suites and regression requirements for future format adapters
- [Controlled document metadata](./architecture/document-metadata.md) — system and personal classification vocabularies
- [Issuers](./architecture/issuers.md) — reusable sender records, document references, and deterministic worker matching
- [Document search](./architecture/search.md) — page text search, snippets, and the semantic-search extension point
- [Document bulk actions](./architecture/bulk-actions.md) — page-scoped selection and batch document operations
- [Virtual folders](./architecture/virtual-folders.md) — owner-scoped logical folder trees and document links
- [Document and folder sharing](./architecture/sharing.md) — read-only sharing between accounts on one Binder server
- [Document exports](./architecture/document-exports.md) — selected-document and folder ZIP exports
- [Saved searches](./architecture/saved-searches.md) — owner-scoped reusable list and semantic searches
- [Backup and scheduled maintenance](./architecture/backup-and-scheduling.md) — PostgreSQL backup/restore, retention, and recurring jobs
- [Extensions and plugins](./architecture/extensions.md) — versioned extension points, calendar automation, and email import
- [Email integration](./architecture/email.md) — SMTP configuration, IMAP import configuration, and the mailbox adapter boundary
- [Calendar integration](./architecture/calendar.md) — owner-scoped iCalendar events from due-date metadata
- [iOS app](./int/ios-app-mvp.md) — native SwiftUI app direction and MVP scope
- [Document format adapters](./int/document-format-adapter-plan.md) — phased plan for a universal format boundary with PDF as the baseline
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

P0, P1, P2, and P3 are implemented. P3 includes administrator-managed AI provider profiles, independent assistant/embedding provider selection, file-aware PDF analysis, PostgreSQL-backed per-document audit history, bulk metadata editing with preview, overwrite confirmation, immutable change sets, selected-document and folder ZIP exports, PDF/A-2b archive derivatives, the resumable first-run onboarding assistant, the first owner-scoped iCalendar integration, secure email import, password reset and password change, and disaster-recovery onboarding with encrypted backup restore, worker progress, mounted-volume-safe storage replacement, pipeline pausing, and post-restore configuration review. Disaster recovery has been exercised by restoring into an installation running in a clean container. Binder supports three document-entry paths: the inbox folder, email import, and client drag-and-drop upload. The inbox folder is also the integration boundary for scanners and other external sources; a separate scanner protocol is not planned. P4 accessibility, localization, server-backed translation catalogs, semantic theme tokens, document version families, manual version linking, title-based version suggestions and linking from document history, non-destructive splitting, page rotation, multi-document composition with page-range selection and source ordering in the API, web client, and iOS app, and reversible metadata changes in document history are implemented. JPEG and PNG image support is implemented; the adapter plan still calls for a deployed rollout smoke test. The native SwiftUI iOS app supports personal-use search, document upload, PDF/image viewing, capture, sharing, offline upload queuing, folder browsing, version history, page rotation, splitting, multi-document composition, requeueing, AI suggestions, and document deletion; App Store preparation remains future work.
