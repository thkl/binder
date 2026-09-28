# Document exports

## Scope

Binder should support exporting selected documents and all documents linked to
a virtual folder as a ZIP archive. Export is a copy operation: originals stay
in their managed storage location and are never renamed or moved.

## Processing model

Exports should run as durable background jobs once more than a small number of
documents is requested. The API creates an owner-scoped export request, the
worker assembles the archive, and the client receives progress and a short-lived
download URL. Small exports may be streamed directly if the size limit is
explicit and enforced.

The archive should contain:

- original document files;
- a manifest mapping archive paths to document UUIDs, original filenames,
  titles, and selected metadata;
- optional OCR text only when the user explicitly requests derived data.

Archive filenames must be sanitized and collision-safe. The manifest is the
authoritative mapping when two documents have the same original filename.
Derived thumbnails, embeddings, and internal pipeline files are excluded by
default.

## Security and retention

The export query must resolve document ownership before the archive job is
created. A folder export may include only documents linked to a folder the
requesting user can access. Archives are temporary derived artifacts with a
configurable retention period, are not served from the raw document directory,
and must be deleted after expiry.

Export activity should be logged without logging document contents. Failed
exports must expose a safe status and retry path rather than leaving a partial
archive available for download.
