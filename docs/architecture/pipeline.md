# Document pipeline

## First implementation

Pipeline jobs are durable PostgreSQL records. Uploading a document creates a
`scanning` document and a queued `malware-scan` job after the original file is
stored. Text extraction, OCR, and AI jobs are only queued after a clean scan.
The API does not execute extraction, OCR, or malware scanning in the HTTP
process.

Each job has:

- an owning document and user
  - a kind: `malware-scan`, `thumbnail`, `text-extraction`, `ocr`, or `embedding`
- a status: `queued`, `running`, `succeeded`, `failed`, or `cancelled`
- attempt and retry limits
- availability, lock, start, completion, and error fields

State changes are accompanied by append-only job events. Jobs and events are kept in PostgreSQL so an eventual worker can restart without losing work.

## Current API

The document API exposes the authenticated owner's pipeline state:

```text
GET /api/v1/documents/:uuid/pipeline
```

Failed or previously uploaded documents can be queued again by their owner:

```text
POST /api/v1/documents/:uuid/pipeline/requeue
```

The API verifies ownership and that the original file exists in configured
storage before creating a new malware-scan job. Requeued documents pass
through the same scan gate again.

The endpoint returns jobs and their safe event messages. It never returns document contents or worker internals.

## Worker boundary

The worker is `packages/worker`. It claims queued jobs with PostgreSQL locking, executes one bounded processing operation, and records the result. Run it with `pnpm --filter @binder/worker dev` during development or as a separate container in production. It depends on the shared database and storage volume; it does not call HTTP controllers or own document authorization.

The first worker operations are:

1. malware scanning with the configured ClamAV-compatible command
2. text extraction from text-based PDFs (implemented with MuPDF)
3. OCR for scanned PDFs (job is queued when no text layer is found)
4. chunking and search indexing

Documents that fail scanning are marked `quarantined`. The API blocks their
file, thumbnail, extracted-text, search, export, and AI access until an
operator requeues them after resolving the scanner result.

Text extraction and OCR persist one `document_pages` row per extracted PDF page and update `documents.page_count`. Existing records and non-PDF records use `pageCount = 1` as the safe default.

Every operation must be idempotent, retryable, observable, and safe to run again without changing the original file.
