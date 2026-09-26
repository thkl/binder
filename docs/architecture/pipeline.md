# Document pipeline

## First implementation

Pipeline jobs are durable PostgreSQL records. Uploading a document creates a queued `text-extraction` job after the original document record is stored. The API does not execute extraction or OCR in the HTTP process.

Each job has:

- an owning document and user
- a kind: `thumbnail`, `text-extraction`, `ocr`, or `embedding`
- a status: `queued`, `running`, `succeeded`, `failed`, or `cancelled`
- attempt and retry limits
- availability, lock, start, completion, and error fields

State changes are accompanied by append-only job events. Jobs and events are kept in PostgreSQL so an eventual worker can restart without losing work.

## Current API

The document API exposes the authenticated owner's pipeline state:

```text
GET /api/v1/documents/:uuid/pipeline
```

The endpoint returns jobs and their safe event messages. It never returns document contents or worker internals.

## Worker boundary

The next pipeline step is a worker that claims queued jobs with PostgreSQL locking, executes one bounded processing operation, and records the result. The worker will depend on storage and pipeline contracts; it must not call HTTP controllers or own document authorization.

The first worker operations are:

1. text extraction from text-based PDFs
2. OCR for scanned PDFs
3. chunking and search indexing

Every operation must be idempotent, retryable, observable, and safe to run again without changing the original file.
