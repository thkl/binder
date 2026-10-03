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

The homepage upload flow now reports progress and links to the inbox, rejects
duplicate content by SHA-256 before creating a second document, supports
owner-scoped complete deletion, and can optionally run inbox AI analysis
automatically after text extraction. Hosted embeddings remain an independent
worker setting and run automatically after text extraction when enabled.

### P3 — connect Binder to the rest of life

- Configurable AI provider profiles ✅ Implemented:
  - Maintain multiple named providers with encrypted credentials.
  - Let administrators test and manage each provider independently.
  - Select the provider separately for document assistance and embeddings.
  - Keep provider-specific endpoints and models while sharing the existing
    server-side safety and response validation.
- Optional, user-triggered PDF file analysis with a custom prompt ✅ Implemented:
  - Make the complete workflow manual: the user opens a document they are
    authorized to access, sees the PDF in the client, enters a prompt below the
    preview, and explicitly starts the analysis.
  - Send the original PDF to a provider that supports file-aware analysis and
    pass it to the model as an input file instead of using extracted text only.
  - Show clearly that the original document is sent to the configured external
    provider and require the normal owner-scoped access check before upload.
  - Enforce file-size, MIME-type, timeout, and response limits; clean up
    provider-side uploads where the provider supports deletion.
  - Configure automatic expiration for provider uploads using the provider's
    file-lifetime controls, with a short default such as one hour.
  - Keep the provider file ID and response chain server-side in an
    owner-scoped analysis session; the client receives only its local session
    UUID and chat messages.
  - Reuse the provider upload for follow-up messages through the response
    chain instead of uploading the PDF again.
  - Keep the result as an explicit analysis response until the user chooses to
    save any metadata or notes.
- Generate validated PDF/A-2b archive derivatives while preserving the original upload. ✅ Implemented:
  - Keep the original immutable and write `derived/<document-uuid>/archive.pdf`.
  - Run conversion through the existing worker with retryable `pdfa` jobs.
  - Expose archive state in document responses and let users request or download the derivative.
- Simplify document-list archive actions ✅ Implemented:
  - Keep “Create archive” in the document drawer instead of repeating it on every list row.
  - Make the list download control direct when only one file version exists.
  - Offer a compact version picker when both the original and PDF/A archive are available.
- Add an owner-scoped pipeline job monitor showing queued, running, failed, and completed jobs,
  with safe failure details and retry actions for recoverable jobs. ✅ Implemented:
  - Filter and paginate jobs by status and task kind.
  - Refresh the monitor automatically while it is open.
  - Keep job and document access owner-scoped and redact common secret patterns in failure details.
- Replace the basic log viewer with an explorer-style log view that supports browsing log files,
  filtering by level and date, and readable inspection of structured entries. ✅ Implemented:
  - Browse application and worker logs from a source sidebar.
  - Filter files by source, file type, name, and date range.
  - Filter the selected log content by level or text and copy the filtered view.
- Expand homepage document ingestion so the complete home content background is
  the PDF drop zone, with a clear drag-over state and the file-picker fallback
  retained. ✅ Implemented:
  - The full home content area accepts dropped PDFs and keeps the search and
    results workflow available underneath the drop state.
  - File-picker and drag-and-drop uploads support multiple PDFs through a
    sequential upload queue with progress and clear validation feedback.
- Add extensions and integrations without changing the core document workflow.
  ✅ Foundation implemented:
  - Packaged plugins register typed manifests at API startup.
  - Owner-scoped document audit events can be consumed without blocking the
    core document transaction when a plugin fails.
  - Runtime code loading and database-configured module paths are intentionally
    excluded from the security boundary.
- Turn invoice due dates into calendar entries ✅ First slice implemented:
  - A reviewed built-in calendar plugin listens to metadata, title, and accepted AI suggestion events.
  - It creates one owner-scoped iCalendar event per document from a configurable custom due-date field.
  - Existing documents can be synchronized manually from the document drawer.
  - The API exposes authenticated `.ics` downloads and adds the event URL to document responses.
  - External Google/CalDAV providers and two-way synchronization remain future work.
- Start email integration ✅ Configuration slice implemented:
  - Add encrypted SMTP credentials for password reset and outbound notifications.
  - Add IMAP mailbox settings, import owner, polling interval, and post-import handling.
  - Keep the actual mailbox adapter on the existing inbox/import pipeline and process it next.
- Import documents from email
- Add secure email-based password reset for local accounts
- Connect scanners and other external sources
- Learn from explicit user corrections to improve recurring-document classification ✅ Implemented:
  - Record a user changing an AI-selected or empty category, type, issuer, or tag
    as owner-scoped classification feedback.
  - Recognize recurring document templates even when variable values such as
    payment months, dates, invoice numbers, or amounts change.
  - Prefer a strong, explainable user feedback match over a conflicting AI
    suggestion, while keeping existing manually assigned metadata untouched.
  - Keep feedback personal and vocabulary-aware; one correction must not create
    a global rule for other users or unrelated documents.
  - Show the learned source and allow users to review or remove a learned
    classification rule.
- ✅ Record an owner-visible audit history for every document, persisted in PostgreSQL and separate from operational logs
- Add a secure first-run onboarding assistant that creates the administrator and validates the basic runtime settings ✅ Implemented:
  - Resumable administrator, storage, processing, optional AI, optional OIDC, backup, and review steps.
  - Server-side writable-path checks for storage, derived files, temporary files, inbox, and backup destinations.
  - Worker heartbeat validation for processing readiness.
  - Separate persisted onboarding completion state from administrator creation.
- Let administrators inspect API and worker activity ✅ Implemented through the API and worker log explorer
- ✅ Add bulk metadata editing for selected documents, including type, category, issuer, tags, custom fields, and virtual-folder assignments:
  - Preview empty values, existing values, conflicts, and the affected documents before applying changes.
  - Require explicit confirmation before overwriting existing metadata or folder assignments.
  - Offer fill-empty, skip-existing, and replace-selected policies.
  - Store each successful operation as an immutable metadata change set so it can be rolled back safely.

### P4 — document history, splitting, and companion clients

- Add document version families so a newly imported document can be linked to
  an existing document as a new version without overwriting either original.
- Provide a manual version-link action from the document list, inbox, and
  metadata view, with a visible version timeline and access to every stored
  file.
- Split documents non-destructively by extracting a page range or all pages
  from page X onward into a new document linked to the source's version
  family. The original document remains unchanged until an explicit version
  or replacement decision is made.
- Define how split-document titles, metadata, folder links, AI suggestions,
  audit events, and pipeline processing are copied or reset when a derived
  document is created.
- Suggest possible version links using normalized original filenames and other
  non-destructive signals, but never link or merge documents automatically
  without user confirmation.
- Define how version metadata, folders, search results, and the current/latest
  version are represented while retaining owner-scoped access checks.
- Link reversible metadata change sets into the document history timeline while
  keeping metadata rollback separate from binary PDF version families.
- Add a Swift iOS companion app with Share Sheet document ingestion.
- Queue shared documents locally when offline and upload them automatically when
  the backend is reachable again.

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
