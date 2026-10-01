# Document audit history

## Goal

Binder should provide a per-document history that answers who or what changed
a document, what changed, and when it changed. This is different from Winston
application logs: operational logs describe service behavior, while document
history belongs to the document and must remain understandable after logs have
rotated.

This is a P3 feature.

The first implementation stores append-only events in PostgreSQL in the
`document_audit_events` table. Winston remains the operational log and is not
used as the source of document history. The API exposes the owner-scoped,
paginated `GET /api/v1/documents/:uuid/audit` endpoint, and the document drawer
shows the events in a localized History tab.

## Events to record

The first version should cover the document lifecycle and user-visible
changes:

- document uploaded or imported;
- document processing, OCR, embedding, or archive status changed;
- title changed;
- document type, category, issuer, tags, or custom metadata changed;
- folder membership added or removed;
- AI suggestion generated, accepted, partially accepted, or dismissed;
- document requeued or processing failed;
- document exported or downloaded, where access auditing is enabled;
- document deleted, restored, or permanently removed once trash exists.

Each event has an actor UUID when caused by a user, a system actor when caused
by the worker or scheduler, a timestamp, event type, and a safe structured
summary. Pipeline and request correlation identifiers should be included when
available.

## Data protection

Audit entries must not contain raw document files, full OCR text, embeddings,
passwords, session tokens, or complete sensitive metadata snapshots. Changes
should record affected field names and redacted before/after values only when
that is necessary for the UI and safe for the configured retention policy.

Audit entries are append-only from the application perspective. Corrections to
an audit record require a new event rather than mutating the historical event.
Retention and administrator access must be explicit before production use.

## API and ownership

The API should expose an owner-scoped endpoint such as:

```text
GET /api/v1/documents/:uuid/audit
```

The endpoint must apply the same document ownership or permission check as the
document detail and extracted-text endpoints. Administrators may receive a
separate operational view according to the future permission model; admin
status alone must not bypass document ownership accidentally.

The response contract belongs in `packages/common` and must be validated with
Zod. Pagination is required because a document may accumulate many events.

## Write boundaries

User-triggered mutations should write their audit event in the same database
transaction as the document change. Worker events should be written after the
pipeline state transition succeeds and should reference the pipeline job. A
failed transaction must not leave an audit event claiming that a change was
committed.

The client should add a History tab to the document drawer alongside preview,
extracted text, and metadata. It should show actor, localized event label,
timestamp, and a concise change summary without exposing internal stack traces
or raw processing output.
