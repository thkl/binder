# Inbox queue

The inbox is an ingestion queue backed by the configured storage root. The worker watches the configured `inbox.path`, creates an `inbox_items` row for each candidate, and then atomically moves accepted PDFs into the normal document storage layout.

Each queue item has two independent state machines:

- import state: `new`, `processing`, `imported`, `duplicate`, `rejected`, or `failed`
- AI state: `pending`, `processing`, `ready`, or `failed`

This means the UI can distinguish a file waiting for the worker from an imported document waiting for AI analysis. Completed queue history is retained only when the configured completion policy has not reached its removal stage.

The admin-only API endpoints are:

- `GET /api/v1/inbox` — returns queue items and the number of AI candidates
- `POST /api/v1/inbox/ai-process` — creates persisted AI suggestions for all imported candidates. When `ai.automaticClassification.enabled` is enabled and the suggestion confidence reaches `ai.automaticClassification.confidence` (for example `0.8` means 80%), the API applies only fields that are still empty. Existing type, category, tags, custom metadata, and manually changed titles are never overwritten. A title equal to the original filename is treated as empty.

The Angular inbox route is `/inbox`. The worker owns import state; the API owns the batch AI suggestion operation because the configured AI provider and controlled metadata vocabulary are API services.

## Completion and live updates

The runtime setting `inbox.completionStage` controls when a successful inbox item is removed:

- `import` removes it as soon as the worker has safely created the document and pipeline job.
- `ai-analysis` keeps it available until the AI analysis succeeds, then removes it.

The default is `ai-analysis`. The API removes stale completed records when the queue is listed, so items already marked `aiStatus=ready` do not remain visible after the policy is enabled.

Administrators can subscribe to `GET /api/v1/inbox/events` using an authenticated Server-Sent Events connection. The API emits application changes immediately and checks the database periodically for worker changes. The client uses this stream to reload the inbox queue without a browser refresh.
