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

The initial configuration should be environment-based:

```text
DOCUMENT_STORAGE_ROOT=./storage
DOCUMENT_MAX_UPLOAD_BYTES=52428800
DOCUMENT_ALLOWED_EXTENSIONS=pdf,jpg,jpeg,png,txt
DOCUMENT_KEEP_DERIVED_FILES=true
DOCUMENT_MALWARE_SCAN_REQUIRED=true
```

Runtime inbox settings are stored in PostgreSQL and editable by an administrator:

```text
inbox.enabled=false
inbox.path=inbox
inbox.importOwnerUuid=<internal user UUID>
inbox.pollIntervalMs=5000
inbox.stabilityMs=2000
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
- Deletion must remove the database record and managed files as one explicit operation, with cleanup failures recorded for retry.

## Backup expectations

A usable backup must include:

1. PostgreSQL data.
2. The configured `documents/` directory.

The `derived/` directory is rebuildable, although retaining it reduces recovery time. The project should later provide a consistency check that compares database file references, hashes, scan status, and filesystem contents.

## Future storage abstraction

Application services should depend on a storage interface rather than directly on filesystem APIs. The first implementation will provide a filesystem adapter. An object-storage adapter can be added later without changing the document or pipeline APIs.
