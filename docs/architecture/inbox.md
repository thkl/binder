# Inbox queue

The inbox is an ingestion queue backed by the configured storage root. The worker watches the configured `inbox.path`, creates an `inbox_items` row for each candidate, and then atomically moves accepted PDFs into the normal document storage layout.

Each queue item has two independent state machines:

- import state: `new`, `processing`, `imported`, `duplicate`, `rejected`, or `failed`
- AI state: `pending`, `processing`, `ready`, or `failed`

This means the UI can distinguish a file waiting for the worker from an imported document waiting for AI analysis. Completed queue history is retained only when the configured completion policy has not reached its removal stage.

The admin-only API endpoints are:

- `GET /api/v1/inbox` — returns queue items and the number of AI candidates
- `POST /api/v1/inbox/ai-process` — creates persisted AI suggestions for all imported candidates. Suggestions are stored on the document before the confidence threshold is evaluated. When `ai.automaticClassification.enabled` is enabled and the suggestion confidence reaches `ai.automaticClassification.confidence` (for example `0.8` means 80%), the API applies only fields that are still empty and clears the suggestion after successful automatic approval. Suggestions below the threshold remain available in the document metadata panel for field-by-field or all-at-once review. Existing type, category, tags, custom metadata, and manually changed titles are never overwritten. A title equal to the original filename is treated as empty.
- `ai.automaticAnalysis.enabled` can run the same inbox analysis in the API background monitor. It only processes documents with extracted text, so uploads remain pending while malware scanning or OCR is still running. The existing `embeddings.enabled` setting controls the worker's automatic embedding job after text extraction.

- Browser uploads and watched-folder imports use the SHA-256 checksum as their duplicate identity. A duplicate browser upload is rejected before a new document record is created; watched-folder duplicates remain visible as inbox duplicate items for cleanup.
- `DELETE /api/v1/inbox/:uuid` — manually removes an inbox item when a stale record remains after a completed import or analysis.
- `DELETE /api/v1/documents/:uuid/ai-suggestion` — clears a pending document suggestion after it has been accepted or dismissed.

The Angular inbox route is `/inbox`. The worker owns import state; the API owns the batch AI suggestion operation because the configured AI provider and controlled metadata vocabulary are API services.

## Completion and live updates

The runtime setting `inbox.completionStage` controls when a successful inbox item is removed:

- `import` removes it as soon as the worker has safely created the document and pipeline job.
- `ai-analysis` keeps it available until the AI analysis succeeds, then removes it.

The default is `ai-analysis`. The API removes stale completed records when the queue is listed, so items already marked `aiStatus=ready` do not remain visible after the policy is enabled.

When `ai.automaticAnalysis.enabled` is active, the effective completion stage is
`ai-analysis` even if `inbox.completionStage` is set to `import`; otherwise the
worker could remove watched-folder items before the automatic analysis monitor
can process them.

Administrators can subscribe to `GET /api/v1/inbox/events` using an authenticated Server-Sent Events connection. The API emits application changes immediately and checks the database periodically for worker changes. The client uses this stream to reload the inbox queue without a browser refresh.

## AI review persistence

The document metadata response includes the pending `suggestion` when one exists. This allows the review flow to work even after the inbox item has been removed by the completion policy. The client clears the stored suggestion only after the user accepts all suggestions or explicitly dismisses them; accepting the title alone updates the title but leaves the remaining suggestion fields available for review.
