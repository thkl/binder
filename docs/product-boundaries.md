# Product boundaries

This document defines the scope of the first release. It is intentionally narrower than Paperless-ngx.

## In scope for the first release

- One local installation
- Local accounts initially, with ownership fields present from the first schema
- PDF upload, with a storage abstraction that can support images and text later
- Filesystem storage for original files
- PostgreSQL for metadata and search indexes
- Background processing with visible status
- Text extraction from text-based PDFs
- Full-text search
- Optional embeddings and semantic search
- Document detail pages with original-file access
- Manual metadata editing
- Editable human-readable document titles separate from immutable original filenames
- Retry and reprocessing

## Explicitly out of scope initially

- Multi-tenant accounts
- Fine-grained permissions and sharing
- Email ingestion
- Watched folders
- Mobile applications
- Editing document contents
- Digital signatures
- Legal hold and retention compliance
- Automatic deletion policies
- Distributed processing
- Storing original binaries in PostgreSQL

## Boundary decisions

### Original versus derived data

Original files are immutable application inputs. OCR output, extracted text, previews, and embeddings are derived data and may be regenerated.

The original filename is preserved as technical source metadata. The document title is an editable presentation field. Automated title suggestions are never applied without user confirmation.

### LLM responsibility

The LLM may interpret queries and suggest metadata. It must not be required for upload, storage, basic extraction, or exact search.

### Authentication

Local authentication is the primary authentication mode. OIDC is an optional login provider that resolves an external identity to an existing internal user. OIDC identities must be mapped by issuer and subject, not by an unverified display name or email alone.

The API uses server-side Express sessions. A localhost-only JWT login mode may exist for local development, but it must be disabled outside an explicitly enabled development configuration and must never become a production authentication mechanism.

### Search responsibility

Search combines PostgreSQL full-text search, optional vector similarity, and metadata filters. Vector search is an enhancement, not the sole source of truth.

### Failure behavior

A failed optional step must not destroy or hide the original document. A document may remain available for download even when OCR, embeddings, or metadata extraction fails.

### Ownership behavior

Every document has an owner reference from the first database schema. For interactive requests, the owner is the authenticated internal user. Documents imported by a watched/upload folder are assigned to an explicitly configured internal owner from application settings. Application services must scope reads and writes by the authenticated user; controllers must not be the only place where ownership is enforced.

## Revisit triggers

Reconsider these boundaries when one of the following becomes true:

- More than one person needs access.
- The storage volume no longer fits comfortably on local disk.
- Importing documents manually becomes the dominant user complaint.
- Processing throughput requires more than one worker.
- Retention, audit, or legal requirements become product requirements.
