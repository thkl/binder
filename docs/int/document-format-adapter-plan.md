# Document format adapters

## Goal

Introduce a small, explicit format boundary so Binder can support document
formats beyond PDF without spreading format checks through the API, worker, and
clients. PDF remains the reference implementation and the default format for
the first implementation phase. The first change is an architectural
refactoring: it must preserve the current PDF behavior before another format
is enabled.

“Document format” means the file representation, such as PDF or a future image
format. It is separate from Binder's business classification of a document
(invoice, contract, receipt, and so on).

## Current behavior and constraints

- The API upload endpoint accepts one file, applies a 50 MiB limit, then
  `DocumentService.upload` validates and stores it through PDF-specific
  methods. It sets `mimeType` to `application/pdf` and starts the normal
  processing pipeline.
- The API storage service uses MuPDF for PDF validation and PDF page
  operations. The worker also uses MuPDF for text extraction and thumbnails;
  OCR and PDF/A processing are PDF-specific.
- The inbox importer validates PDF bytes, and email import currently filters
  attachments to PDFs. These import paths must not accidentally advertise
  support for a format they cannot process.
- Search and extracted text are stored by page number. `pageCount` currently
  has a minimum of one and uses one as a default before extraction. This is a
  compatibility constraint for formats without pages.
- `DocumentSchema.mimeType` is already a string, while some request and
  operation contracts are explicitly PDF-only. Format discovery should be a
  new shared contract; it should not overload document classification or
  silently change existing PDF endpoint semantics.
- API and worker Vitest coverage is in place. Extend that coverage as each
  boundary moves, following [the test strategy](../architecture/testing.md).

## Phase 0 characterization matrix

This matrix captures the current PDF contract before moving implementation
boundaries. It is the regression checklist for the adapter refactor.

| Path | Current PDF behavior | Format-coupled boundary |
| --- | --- | --- |
| Web upload | `POST /api/v1/documents`; one file, 50 MiB limit; browser pre-check accepts PDF MIME or `.pdf` suffix; API validates and stores PDF before queuing processing. | `DocumentController`, `DocumentService.upload`, PDF storage methods, and web picker checks. |
| iOS upload/share | Share extension and offline queue accept PDF; scanner creates PDF; upload multipart request declares `application/pdf`. | `ShareViewController`, `SharedPDFQueue`, scanner, and `BinderAPI`. |
| Inbox import | Only `.pdf` names are accepted; byte content is validated before a document row is stored. | Worker inbox importer. |
| Email import | Attachment must declare `application/pdf` and have a `.pdf` filename suffix. | Worker email importer filtering. |
| Malware and processing | Scan is first; successful scan queues text extraction. Text extraction writes page text, determines OCR need, and queues thumbnail, OCR when needed, embedding, and optional PDF/A work. Quarantined files remain inaccessible through protected document paths. | Worker pipeline stages and PDF-specific extract, render, OCR, and PDF/A helpers. |
| Search | Text and semantic results can identify a PDF page; extracted text is persisted per page. | `document_pages`, page-numbered embeddings, and `pageCount` defaults. |
| Preview and download | PDF thumbnail is rendered by MuPDF; file route streams original document with its stored MIME type; iOS uses PDFKit. | API and worker thumbnail generation, plus iOS PDF viewer. |
| Page editing | Rotation, splitting, and composition use PDF page operations and are exposed as document actions. | PDF storage service and PDF-specific API routes/contracts. |
| Export and archive | Original file download and ZIP exports retain source document bytes; PDF/A is an optional derived archive artifact. | MIME-aware streaming plus PDF/A worker job. |

The web upload pre-check is only a convenience: allowing either PDF MIME or a
`.pdf` suffix does not validate the content. The API remains the enforcement
point. The current iOS share and offline queue are intentionally PDF-only.

### Phase 0 baseline result — 2026-10-11

- API: `pnpm --filter @binder/api test` passed. This runs the API TypeScript
  build and Vitest: 13 test files, 42 tests.
- Worker: `pnpm --filter @binder/worker test` passed. This runs the worker
  TypeScript build and Vitest: 6 test files, 28 tests.
- No test failures were reported. The API suite logs expected error cases from
  tests that exercise encryption and plugin failure handling.
- No runtime behavior or implementation code changed in Phase 0.

**Phase 0 status: complete.** Next is Phase 1: define the shared format
descriptor, API/worker registry shape, and authenticated discovery contract.

## Design decisions for the initial architecture

1. **Use a closed registry, not a runtime plugin loader.** The API and worker
   register known format implementations in code. This keeps the supported
   surface reviewable and avoids loading arbitrary code or configuration as a
   plugin.
2. **Use stable format identifiers and explicit capabilities.** Examples:
   `pdf`, `image`. Capabilities describe user-visible and processing
   operations. A format must not claim a capability until its full path is
   implemented and tested.
3. **Keep PDF as the baseline adapter.** The initial rollout registers only
   PDF. Adding the abstraction must leave PDF upload, malware scanning, text
   extraction, OCR, thumbnails, search, export, preview, page rotation,
   splitting, composition, and PDF/A behavior intact.
4. **The server is authoritative.** Client-provided filename and MIME type are
   hints. The server identifies content from bytes, opens it with the
   appropriate safe parser, and rejects unknown, malformed, or mismatched
   content before creating a document or job. Client filtering improves the
   picker but is never a security check.
5. **Only advertise end-to-end supported formats.** A format is listed to
   clients only when upload, scanning, processing, storage, preview/download,
   and the required user flows are supported. A file extension allowlist
   alone does not mean a format is supported.
6. **Keep source files immutable.** Processing and future conversions create
   derived artifacts. Do not convert or replace the uploaded original as a
   side effect of extraction, preview, OCR, or archive generation.
7. **Keep format capabilities narrow.** Avoid one large adapter interface
   whose methods all formats must stub out. Separate common inspection and
   extraction behavior from optional page editing, OCR, archival conversion,
   or composition operations. API routes must check capability support before
   invoking format-specific work.

## Target boundaries

### Shared contract

Add shared Zod types in `packages/common` for format discovery. Each format
descriptor should include:

- stable format ID and localized/display name key;
- accepted extensions and MIME types for picker hints;
- capabilities needed by clients and processing, initially including upload,
  preview, text extraction, OCR input, page count, page rotation, splitting,
  composition, and PDF/A where applicable;
- a contract version if the descriptor shape needs independent evolution.

The descriptor is metadata, not executable plugin code. Keep it serializable
and safe to return from the API. The API and worker must not depend on each
other's runtime package; share IDs and descriptor schemas through `common`,
and implement runtime operations in their respective package boundaries.

### API

- Provide an authenticated format-discovery endpoint, for example
  `GET /api/v1/document-formats`, generated from the API's registered formats.
- Route upload bytes through format detection and validation before persistence
  or enqueueing. Store the detected canonical MIME type and a safe extension
  selected by the detected format, not an extension trusted from the client.
- Preserve original filename for display, but do not use it as a storage path.
- Return a clear unsupported-format response for unrecognized or disabled
  formats. Keep size, ownership, quarantine, and upload throttling behavior.
- Keep PDF-only operations explicit. Rotation, split, compose, and PDF/A
  should fail cleanly for formats without those capabilities rather than
  attempting a PDF parser on arbitrary bytes.

### Worker

- Dispatch validation, extraction, and preview generation by detected format.
- Keep the malware scan as a hard gate before parsers, renderers, OCR,
  thumbnailing, AI, or export can inspect document content.
- Make shared pipeline stages format-neutral only where their behavior really
  is generic. PDF OCR, PDF/A, page rendering, and page editing remain in the
  PDF adapter and are scheduled only when supported.
- Preserve retry behavior, idempotency, observability, storage safety, and
  original-file immutability. A failed adapter step must not leave a document
  appearing fully processed.

### Clients

- Fetch the supported-format descriptors from the API and use extensions and
  MIME types to filter file pickers and explain unsupported selections.
- Apply the same user-facing constraints to web upload, iOS file import, and
  share-sheet intake where practical. For share extensions and generic MIME
  types such as `application/octet-stream`, allow the server to make the final
  decision and show its result.
- Display actions only when the document format advertises the capability.
  Keep preview/download usable for each advertised format; do not assume every
  file can be embedded in the current PDF viewer.
- Cache format descriptors for offline UI fallback if useful, but never treat
  a cached list as permission to bypass server validation.

## Phased implementation plan

### Phase 0 — Characterize the PDF baseline

- Inventory every API, worker, web, and iOS path that reads, writes, previews,
  transforms, imports, or exports a document.
- Record current PDF contracts and status/error behavior, including upload,
  queued offline upload, inbox/email import, search, thumbnail, download,
  requeue, OCR, archive, sharing, versions, page rotation, split, and compose.
- Use the existing Vitest suite as the regression baseline. Add missing tests
  only around behavior that will be moved by this refactor.
- Confirm any legacy extension or MIME allowlists do not claim support beyond
  what the API and worker can actually process.

**Exit gate:** a written PDF behavior matrix and passing API/worker regression
tests before moving implementation boundaries.

### Phase 1 — Define format IDs, capabilities, and registry shape

- Add the shared format descriptor and discovery response schemas to
  `packages/common`.
- Define capability names and meanings precisely. In particular, distinguish
  preview from native file download, and OCR input from OCR implementation.
- Add API and worker registries with a single `pdf` entry and parity checks
  against the common descriptor. Do not enable another format in this phase.
- Add the authenticated discovery endpoint and contract tests.

**Exit gate:** clients can retrieve a PDF descriptor, and API/worker registry
tests agree on the stable format ID and capability contract.

**Phase 1 status: complete.** The shared contract currently advertises the
PDF format and its capabilities. The authenticated endpoint is
`GET /api/v1/document-formats`; API and worker builds use the same shared
catalog. The descriptor is metadata only; PDF runtime operations remain in
their existing services until later phases.

Validation on 2026-10-11: common build and 5 tests passed; API build and 44
tests across 14 files passed; worker build and 29 tests across 7 files passed.

### Phase 2 — Centralize authoritative upload detection

- Add a server-side detector that selects a registered adapter from file
  content, validates the structure with that adapter, and returns canonical
  format ID, MIME type, and safe extension.
- Reject unknown, malformed, empty, or disallowed files before writing a
  document row or enqueueing processing. Do not trust the multipart MIME type
  or filename suffix.
- Refactor the upload service to persist the detected format metadata while
  preserving original filename, checksum, ownership, limits, cleanup, and
  initial processing status.
- Add adversarial tests for PDF content labeled as another MIME/extension,
  non-PDF content labeled as PDF, malformed PDFs, empty files, and files just
  over the limit. Verify failed detection creates no document or job and
  removes temporary data.
- Review inbox and email import separately: they may continue to accept PDF
  only until their format-specific detection and processing paths are wired.

**Exit gate:** every existing PDF upload/import path stores canonical PDF
metadata; unsupported content is rejected before processing.

**Phase 2 status: complete for the registered PDF format.** The API now checks
the configured size before parsing, detects the PDF signature from bytes,
validates the structure with MuPDF, and uses the registered canonical MIME
type for the document record. Client MIME and filename suffix do not select
the format. Unknown bytes, malformed PDFs, empty files, and oversized files
are rejected before a document record or pipeline job is created. Inbox and
email import remain PDF-only and keep their own existing validation paths;
unifying them is still part of later adapter work.

Validation on 2026-10-11: API build and 46 tests across 14 files passed. Tests
cover misleading client metadata, non-PDF bytes labeled as PDF, malformed
PDFs, empty uploads, and configured size limits. The detector currently has
only the PDF implementation; no other format is enabled.

### Phase 3 — Move API PDF operations behind adapters

- Move PDF validation/storage helpers behind the PDF adapter boundary without
  changing their observable behavior.
- Route thumbnail/preview, page operations, and PDF/A requests through
  capability-aware services. Keep existing PDF route contracts during this
  migration unless a separate API version is deliberately planned.
- Make unsupported-capability errors consistent and test that no PDF parser is
  called for another format.
- Keep derived artifacts separate from the original storage key and preserve
  existing cleanup and transaction behavior.

**Exit gate:** API format-specific logic is behind the adapter boundary, with
existing PDF endpoints and integration behavior unchanged.

**Phase 3 status: complete.** The new `PdfDocumentFormatAdapter` wraps PDF
validation, original storage, thumbnail generation, rotation, splitting, and
composition. `DocumentFormatRegistry` selects it by canonical MIME type and
checks advertised capabilities before the API performs page operations,
previews, file analysis, or PDF/A requests. Original file streaming and
storage cleanup remain format-neutral. Existing routes and response contracts
are unchanged.

Validation on 2026-10-11: common build and 5 tests passed; API build and 49
tests across 15 files passed; worker build and 29 tests across 7 files passed.
The API tests cover byte detection and capability lookup; the existing storage
tests continue to exercise the underlying PDF transformations.

### Phase 4 — Move worker processing behind adapters

- Introduce worker adapter operations for content validation, searchable-text
  extraction, and preview/thumbnail generation.
- Keep optional operations explicit for OCR preparation, archive generation,
  and page-based operations. Schedule only operations supported by that
  document's format.
- Preserve page-level PDF text and search indexing exactly. Ensure retry,
  completion, failure, quarantine, and progress events keep their meaning.
- Add worker tests for dispatch, unsupported capabilities, parser failures,
  retry/idempotency, malware-scan gating, and unchanged PDF extraction results.

**Exit gate:** the worker's generic pipeline can dispatch via the registered
format, and the PDF processing regression suite passes.

**Phase 4 status: complete for the registered PDF format.** The worker now
selects extraction, preview generation, OCR, and PDF/A operations using the
document's canonical MIME type and the requested capability. The PDF adapter
wraps the existing MuPDF, OCRmyPDF, and PDF/A helpers. Claimed jobs carry the
stored MIME type; unsupported formats follow the existing retry/failure path
without reaching PDF parsers. Inbox and email imports validate bytes through
the worker registry. Malware scanning remains a separate first pipeline stage.

Validation on 2026-10-11: common build and 5 tests passed; worker build and 32
tests across 7 files passed; API build and 49 tests across 15 files passed.
The new worker tests cover byte validation and reject unsupported MIME types
before PDF processing; existing tests cover extraction results, OCR behavior,
PDF/A, retry handling, and scan gating.

### Phase 5 — Resolve page-based data assumptions

- Store extracted text as ordered segments. Each row has a 1-based
  `segmentIndex` and a nullable physical `pageNumber`; semantic chunks use the
  same pair so results can keep their source location when one exists.
- `pageCount` is nullable. A positive value means the format has a known
  physical page count; `null` means it has no physical page model. Existing
  PDF rows retain their page counts and page numbers.
- Keep the `document_pages` table name for compatibility, while treating its
  rows as extracted text segments. Backfill `segmentIndex` from `pageNumber`
  for existing rows, then order search, embeddings, issuer matching, and
  classification fingerprints by segment index.
- Preserve `pages` in the extracted-text response for existing PDF clients,
  and add `segments` with an explicit nullable page reference for new clients.
- Search match classification must not infer “title” from a null page number:
  unpaged text segments also have no physical page. The store now tags title
  and text matches explicitly.

**Phase 5 status: complete.** Migration V075 adds and backfills segment indexes,
makes physical page references nullable, and allows `documents.page_count` to
be null. API and worker models, shared schemas, extracted-text responses,
lexical and semantic search, embeddings, AI text ordering, and client page
actions now use the segment model. The migration safety checker permits only
explicit `SET/DROP NOT NULL` column changes in addition to its existing DDL
rules.

Validation on 2026-10-11: common build and 6 tests passed; API build and 51
tests across 15 files passed; worker build and 32 tests across 7 files passed;
client Angular typecheck passed. The PDF worker regression test verifies that
segment ordering and physical page numbers remain aligned.

### Phase 6 — Client discovery and upload filtering

- Add typed API client support for format discovery.
- Filter file selection by advertised extensions/MIME types and show a clear
  message when a selected file cannot be uploaded.
- Keep the file input and share-sheet flows resilient to missing/stale
  descriptors, generic MIME types, and offline mode; server response remains
  authoritative.
- Gate document actions and viewer selection by format capabilities. Continue
  to use the current PDF viewer for PDF documents.
- Add client tests for descriptor loading, filtering, unsupported responses,
  cached/offline state, and capability-driven actions.

**Phase 6 status: complete.** The web client loads and validates the
authenticated format list, caches it in local storage for offline picker
guidance, filters direct selection and drag/drop by MIME type and extension,
and permits generic MIME hints to reach server content detection. The picker
accept strings now come from the upload descriptors. PDF-only actions and the
embedded viewer are capability/format gated, while the server remains the
authority for upload acceptance. English and German upload copy names the
formats provided by the API.

The iOS API client decodes and caches discovery per server origin. Uploads
confirm that PDF is advertised before sending; when discovery is unavailable,
they keep the legacy PDF path and let the upload endpoint decide. The share
extension continues to accept PDFs only, matching the formats the app can
currently scan, queue, and display.

Validation on 2026-10-11: web Angular typecheck and all 14 client tests passed;
the Binder and BinderShare targets built for iOS Simulator. Tests cover server
descriptor loading, picker hints, MIME/extension matching, capability checks,
retaining cached descriptors when discovery is offline, and displaying the
server's rejection for an unsupported file.

### Phase 7 — Enable one additional format

- Select one candidate only after Phases 0–6. Images are a likely first
  candidate because they have clear preview and OCR uses, but they still need
  size, pixel-dimension, decompression-bomb, multi-image, rotation, and
  thumbnail policies. Office formats introduce conversion dependencies and
  additional parser/renderer risks, so evaluate them independently.
- Implement its adapter end to end, including upload detection, safe storage,
  scan gating, worker processing, preview/download, search representation,
  capability discovery, and client UX.
- Advertise it only after all required paths and operational limits are tested.

**Exit gate:** a complete end-to-end test proves an additional format can be
uploaded, safely processed, searched, previewed or downloaded, and handled by
both API validation and client filtering.

### Phase 8 — Rollout and cleanup

- Deploy API and worker code that understands the new registry before
  enabling a new format in the API response.
- Keep the advertised format set configurable or otherwise safely gated for
  staged rollout. Ensure older clients continue to upload PDFs.
- Monitor unsupported-format rejects, parser failures, processing duration,
  memory use, queue retries, and derived-artifact failures.
- Remove duplicated PDF checks only after every path has moved to the
  authoritative detector/adapter. Update architecture docs and setup guidance
  to describe the actual supported formats.

**Exit gate:** staged rollout is reversible and runtime support agrees across
API, worker, web, and iOS.

## Test and review matrix

For every enabled format, cover:

- valid bytes with correct and incorrect client MIME types and file suffixes;
- malformed, empty, unknown, and oversized uploads;
- malware scan pass/fail and proof that parsing is blocked until scan passes;
- persistence of canonical MIME/format metadata and immutable source bytes;
- extraction, OCR if supported, search, thumbnail/preview, download, retry,
  and derived artifact cleanup;
- capability-gated page operations and a clear unsupported response;
- inbox, email, direct upload, iOS share, and offline queue behavior as
  applicable;
- permission, sharing, export, and version behavior for the stored document;
- client picker filtering plus server rejection of manually crafted requests.

Use unit tests for detection and adapters, API tests for authorization and
upload contracts, worker tests for dispatch and retries, and integration tests
for the complete upload-to-search/preview path. Follow the existing
[API and worker test strategy](../architecture/testing.md); do not treat a
successful client-side file picker test as server validation coverage.

## Risks and decisions to revisit

- **Capability drift:** API, worker, and client may disagree. Keep shared IDs
  and schemas in `common`, and test registry parity.
- **Spoofed content:** MIME and suffix checks are insufficient. Detect and
  parse bytes server-side, enforce resource limits, and retain malware gating.
- **Parser resource exhaustion:** formats such as images and Office documents
  can expand dramatically. Set per-format byte, page/pixel, time, and memory
  limits before enabling them.
- **Page-centric search:** future formats may not have physical pages. Decide
  the segment model before enabling unpaged content; do not manufacture page
  counts that affect search behavior.
- **Import path mismatch:** direct upload, email, inbox, and mobile share flows
  must either use the same detector or clearly remain PDF-only.
- **Older clients:** clients that do not understand discovery should continue
  to work with PDF. New formats should not be enabled until compatibility is
  understood.
- **Preview availability:** a format is not ready merely because the worker
  can extract text. Define whether users get a safe preview, a download, or
  both, then advertise only the supported interaction.

## Completion criteria

- PDF behavior is preserved through the refactor and covered by API/worker
  regression tests.
- The server detects and validates bytes, persists canonical format metadata,
  and rejects unsupported content before creating processing work.
- Clients consume the server's supported-format contract for guidance while
  the server remains the enforcement point.
- Format-specific operations are capability-gated and unsupported formats do
  not reach PDF parsers.
- Every advertised format has an end-to-end tested import, processing, search,
  viewing/download, and failure path.
- The supported-format list matches actual API, worker, web, and iOS behavior.

## Working sequence

Work through the phases in order. Keep the initial implementation limited to
the PDF adapter and its regression coverage; choose and enable a second format
only after the boundary is proven with the existing feature-rich PDF path.

Progress: Phases 0 through 6 are complete; Phase 7 is next.
