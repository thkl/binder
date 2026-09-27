# Inbox queue

The inbox is an ingestion queue backed by the configured storage root. The worker watches the configured `inbox.path`, creates an `inbox_items` row for each candidate, and then atomically moves accepted PDFs into the normal document storage layout.

Each queue item has two independent state machines:

- import state: `new`, `processing`, `imported`, `duplicate`, `rejected`, or `failed`
- AI state: `pending`, `processing`, `ready`, or `failed`

This means the UI can distinguish a file waiting for the worker from an imported document waiting for AI analysis. Queue history remains in PostgreSQL after the source file has moved out of the inbox folder.

The admin-only API endpoints are:

- `GET /api/v1/inbox` — returns queue items and the number of AI candidates
- `POST /api/v1/inbox/ai-process` — creates persisted AI suggestions for all imported candidates; suggestions are reviewable and are not applied automatically

The Angular inbox route is `/inbox`. The worker owns import state; the API owns the batch AI suggestion operation because the configured AI provider and controlled metadata vocabulary are API services.
