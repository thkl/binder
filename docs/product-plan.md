# Product plan

## Vision

Build a lightweight, self-hosted document management system inspired by Paperless-ngx. It should store original documents in a predictable folder structure, process them asynchronously, and make them easy to find through both exact and natural-language search.

Example query:

> Find the document about my car inspection last summer.

Expected result: the TÜV report from 05/2025, with a matching text snippet and page reference.

## Technology direction

- Repository: TypeScript monorepo with `packages/api`, `packages/client`, and `packages/common`
- Package manager: pnpm workspaces
- Backend: NestJS
- Backend language: TypeScript 6
- Frontend: Angular 22
- Frontend style: signal-first Angular using `@for`/`@if`, signal stores, and signal forms
- Database: PostgreSQL
- Vector search: PostgreSQL with `pgvector`
- Use a ORM: Sequelize and make sure there are no native sql queries unless there is absolute no way to abstract this
- Data access: `basic-crud` stores between Sequelize models and application services
- API contracts: shared Zod schemas and inferred TypeScript types in `packages/common`
- Logging: Winston with structured logs and rotating file transports
- Original and derived files: configurable filesystem storage
- Processing: asynchronous, retryable document pipeline
- OCR: OCRmyPDF with Tesseract in a dedicated worker process/container
- LLM use: optional and provider-independent
- The App should be running inside a docker container
- Security: continuous dependency, static-analysis, secret, container, and authorization testing in development and CI

## Priorities

### P0 — foundation

- Local authentication with optional OIDC login
- Bootstrap administrator account on an empty database
- Forced password change after first administrator login
- Local login, session, logout, and password-change endpoints
- Ownership fields on documents and related records, ready for future multi-user access control
- Document upload
- Filesystem storage for originals
- PostgreSQL document metadata
- Document list and detail views
- PDF preview/download
- Processing status and failure visibility

### P1 — useful document system ✅ Complete

- Add optional OIDC authentication mapped to internal users
- PDF/text extraction
- OCR for image-only documents
- Full-text search
- Vector search and hybrid ranking
- Page-aware snippets
- Tags and configurable document types
- Suggested title and metadata with manual confirmation
- Retry and reprocess actions
- English and German client localization with an extensible language-code model
- Localized document types, categories, and tags with canonical fallback names
- Admin-editable document analysis prompt with a server-enforced JSON contract

P1 is complete. The system supports the first usable document workflow: upload, durable storage, asynchronous extraction/OCR, controlled metadata, full-text search, optional hosted semantic search, hybrid ranking, user-confirmed AI title/metadata suggestions, and English/German localization. Localization uses flexible language codes so additional translations can be added without changing the contract.

### P2 — organize and protect documents ✅ Complete

- Bring files in through an inbox folder with clear ownership
- Keep duplicate documents under control
- Automatically classify documents and apply known tags
- Reuse issuers so documents can be found by sender
- Select and manage multiple documents at once
- Organize documents in private, nested folders
- Export selected documents or a folder as a ZIP file
- Save useful searches for later
- Make homepage PDF ingestion quick through drag-and-drop and a file-picker fallback
- Back up and restore the archive
- Detect missing or changed originals and notify the document owner
- Keep document access, imports, exports, and recovery reliable

The first P2 slice is the inbox folder. Files copied into the configured `inbox/` directory are treated as external input: the worker claims them safely, validates them, assigns the configured import owner, creates normal document and pipeline records, and moves or marks the source after successful handoff. The inbox must be restart-safe and must not create duplicate documents when the same file is observed more than once. The admin inbox queue persists import state and offers a batch AI analysis action. Optional automatic classification applies only high-confidence suggestions to empty fields; existing metadata and manually changed titles are preserved.

P2 is complete. The archive now has backup and restore workflows, nested
virtual folders, recursive ZIP exports, reusable searches, dependable ownership
and import handling, and scheduled storage consistency checks that compare
originals against their database size and SHA-256 checksum and surface
owner-scoped issues. A real restore drill remains recommended as deployment
verification.

### P3 — connect Binder to the rest of life

- Add extensions and integrations without changing the core document workflow
- Turn invoice due dates into calendar entries
- Import documents from email
- Add secure email-based password reset for local accounts
- Connect scanners and other external sources
- Add a Swift iOS companion app with Share Sheet document ingestion
- Queue shared documents locally when offline and upload them automatically when the backend is reachable again
- Generate validated PDF/A-2b archive derivatives while preserving the original upload
- Record an owner-visible audit history for every document
- Add a secure first-run onboarding assistant that creates the administrator and validates the basic runtime settings
- Let administrators inspect API and worker activity
- Choose different AI providers for embeddings and document assistance
- Test providers and choose privacy-appropriate services for each task
- Add bulk metadata editing for selected documents, including type, category, issuer, tags, custom fields, and virtual-folder assignments

### Later

- Third-party plugin distribution or marketplace
- Multi-user organizations and permissions
- Advanced workflow automation
- Digital signatures and compliance features
- Distributed workers and object storage

## First vertical slice

The first usable milestone is:

> Upload a PDF, store it safely, extract its text, index it, search for it, and open the original document.

Acceptance criteria:

1. A PDF upload creates a document record.
2. The original file is written to configured storage.
3. The file receives a SHA-256 content hash.
4. Text extraction runs asynchronously.
5. Processing status and failures are visible.
6. Exact search returns useful snippets.
7. Semantic search can be enabled without changing the document storage model.
8. The original PDF can be opened.
9. Reprocessing is safe and does not create duplicate chunks or records.

The original filename remains an immutable technical property. The editable document title is a separate human-readable property and may be suggested from the filename and extracted content, but suggestions require user confirmation.

## Product principles

- Original files are preserved and never silently overwritten.
- Automated metadata is a suggestion until confirmed by the user.
- Search should remain useful when the LLM is unavailable.
- Every processing step is observable and retryable.
- Search results should explain why a document matched.
