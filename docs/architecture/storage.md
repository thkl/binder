# Storage configuration

## Decision

The application stores original document files on a configurable filesystem path. PostgreSQL stores document metadata, processing state, hashes, and references to the files. Derived artifacts are stored separately and may be regenerated.

This keeps the first deployment simple while preserving a storage abstraction for a future object-storage backend.

## Directory layout

The configured storage root contains only application-managed document data:

```text
<storage-root>/
└── documents/
    └── YYYY/MM/<document-id>.<extension>
```

Derived artifacts remain separate from the raw document tree:

```text
<storage-root>/
├── documents/
│   └── YYYY/MM/<document-id>.<extension>
├── inbox/
│   └── <external files waiting for import>
├── derived/
│   └── <document-id>/
│       ├── extracted.txt
│       ├── ocr.pdf
│       └── preview/
└── tmp/
```

The first upload implementation creates a first-page PNG preview with the npm `mupdf` package. MuPDF runs through WebAssembly, so the API does not require Poppler, Ghostscript, Cairo, or another operating-system tool. The preview is written to:

```text
derived/<document-id>/thumbnail.png
```

Thumbnail generation is best-effort derived work. A rendering failure leaves the immutable original available and leaves the thumbnail reference empty so a later pipeline retry can regenerate it.

Document list, search, and detail responses expose a stable `thumbnailUrl` for the ownership-protected thumbnail route. The client does not need a separate thumbnail discovery request. The image route remains lazy: if the derived thumbnail is missing, the API generates it on demand.

### Directory meanings

- `documents/`: immutable raw uploaded/imported files. This is the directory a malware scanner can monitor.
- `inbox/`: external drop folder. Files remain here until the importer has safely claimed and validated them. It must not be served over HTTP.
- `derived/`: generated text, OCR output, thumbnails, and other rebuildable artifacts
- `tmp/`: incomplete uploads and temporary processing files; safe to clean only after confirming no active job uses them

The application must never use the user-visible filename as the storage filename. The document ID is the stable name; the original filename is metadata.

Processing must not begin until the configured malware-scanning policy has accepted the raw file. If scanning is disabled for local development, that must be explicit in configuration and visible in application diagnostics.

## Configuration

The initial bootstrap configuration contains only the application root and
database access. Runtime filesystem paths are stored in PostgreSQL settings:

```text
documents.storageRoot=/app
inbox.path=/app/documents/inbox
backup.root=/app/backup
```

With the current storage-key format (`documents/YYYY/MM/<id>.pdf`), using
`documents.storageRoot=/app` places raw documents in `/app/documents` while
keeping derived files under the same application storage base. Absolute paths
are recommended for deployments; relative values remain supported for existing
installations.

The remaining document defaults are:

```text
DOCUMENT_MAX_UPLOAD_BYTES=52428800
DOCUMENT_ALLOWED_EXTENSIONS=pdf,jpg,jpeg,png,txt
DOCUMENT_KEEP_DERIVED_FILES=true
DOCUMENT_MALWARE_SCAN_REQUIRED=true
```

Runtime inbox settings are stored in PostgreSQL and editable by an administrator:

```text
inbox.enabled=false
inbox.path=/app/documents/inbox
inbox.importOwnerUuid=<internal user UUID>
inbox.pollIntervalMs=5000
inbox.stabilityMs=2000
inbox.completionStage=ai-analysis
```

Defaults are development-friendly, but production should use an absolute path outside the application source tree.

### Configuration rules

- Resolve and validate the storage root during application startup.
- Create required subdirectories when the application starts or during an explicit setup command.
- Reject a storage root that is a regular file or not writable.
- Enforce the maximum upload size before processing begins.
- Validate file type using both extension and detected content type.
- Never construct paths from unsanitized user input.
- Assign folder-imported documents to `inbox.importOwnerUuid` or leave them untouched when no active owner is configured.
- Treat the inbox as untrusted input: use atomic claim/rename operations, ignore hidden and temporary files, validate content before moving into `documents/`, and record failures without deleting the source.
- Keep raw files available to the scanner without exposing the storage directory directly over HTTP.
- Keep secrets and LLM credentials out of this configuration document and source control.

## Database references

The document record should retain at least:

- Document ID
- Original filename
- MIME type
- File extension
- File size
- SHA-256 hash
- Relative original path
- Page count (`pageCount`, defaulting to 1 until PDF extraction determines the exact count)
- Processing status
- Created and updated timestamps

Paths should be stored relative to `DOCUMENT_STORAGE_ROOT`, not as machine-specific absolute paths. This makes backups and migrations portable.

## Immutability and replacement

- An uploaded original is immutable.
- Reprocessing updates derived artifacts and search indexes only.
- Replacing a document creates a new version rather than overwriting the original.
- Future document versioning will group immutable document records into explicit
  version families. A user may manually link a newly imported document to an
  existing family and choose the current version; filename-based matching may
  suggest a link but must never apply it without confirmation.
- Deletion must remove the database record and managed files as one explicit operation, with cleanup failures recorded for retry.

## Backup expectations

A usable backup must include:

1. PostgreSQL data.
2. The configured `documents/` directory.

The `derived/` directory is rebuildable, although retaining it reduces recovery time. The worker now provides a scheduled consistency check for the immutable originals. It compares every database document with the configured filesystem, including existence, regular-file status, size, and SHA-256 checksum. Open issues are assigned to the document owner in `document_storage_issues` and are automatically resolved when a later check finds the original healthy.

Deleting a document is an owner-scoped operation. The API removes its dependent database records in a Sequelize transaction and then removes the original file and the complete `derived/<document-uuid>/` directory. A failed filesystem cleanup is logged for operational follow-up; it never exposes another user's document or allows a user to delete outside their ownership scope.

## Future storage abstraction

Application services should depend on a storage interface rather than directly on filesystem APIs. The first implementation will provide a filesystem adapter. An object-storage adapter can be added later without changing the document or pipeline APIs.
