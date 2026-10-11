# Document format adapters

This note records the format boundary introduced for Binder documents. It is
intended as the starting point when adding the next file format.

## What an adapter owns

A format adapter contains operations whose behavior depends on the file
representation. It validates the bytes, stores the immutable source, exposes
previews, extracts searchable content, and performs format-specific processing.
Document ownership, metadata, folders, sharing, pipeline state, and search
index storage remain shared Binder behavior.

The shared schemas in `packages/common/src/index.ts` define the client-facing
descriptor contract and its TypeScript types. Each API and worker adapter owns
its descriptor alongside its implementation. Each registry builds its catalog
from the adapters registered in that process, and the API publishes its own
catalog to clients. This keeps an unimplemented format from appearing in API
discovery just because a shared package lists it. Descriptors contain a stable
ID, accepted MIME types and extensions, and the capabilities available in that
process. The API detects formats from file bytes; client MIME and filename
values are hints only.

## Processing path

1. The API checks the upload byte limit, detects content signatures, validates
   the file with its parser, stores the original bytes, and persists canonical
   MIME and format metadata.
2. The malware scanner gates follow-up processing.
3. The worker selects an adapter using the persisted MIME type. It extracts
   searchable text, creates a thumbnail, and runs OCR when extraction reports
   that OCR is needed.
4. The shared pipeline stores text segments and page numbers, updates the
   document state, and queues embeddings using the existing common flow.
5. The web and mobile clients discover supported formats from the API and use
   capabilities to filter uploads and show only supported actions.

Keep original bytes immutable. Previews and OCR output are derived artifacts.
Do not advertise an operation until the API, worker, and clients can complete
it safely.

## Current adapters

### PDF (`pdf`)

PDF is the reference adapter. It supports upload, download, preview, text
extraction, OCR, file analysis, page count, rotation, split, compose, and PDF/A
archive generation. Its current implementation uses MuPDF and OCRmyPDF.

### JPEG and PNG (`image`)

JPEG and PNG share one image adapter and one document record. One image is one
document and one logical page. Original versions stay in their original format.
The API supports right-angle rotation by creating a new version; PNG rotation is
lossless and JPEG rotation is re-encoded at high quality. The worker uses
Tesseract for searchable text and MuPDF to create a cached PNG thumbnail.
Images do not claim PDF analysis, PDF/A, split, or compose capabilities.

The initial image guardrails are:

- use the JPEG or PNG byte signature and a real parser; never trust the
  extension or multipart MIME type;
- use the existing configured upload byte limit;
- reject images above 20,000 pixels on either edge or above 100 megapixels;
- cap the preview rendering area and Tesseract execution time/output;
- treat malformed images and parser/processing errors through the existing
  failed or quarantine pipeline paths.

## Adding another format

Before adding a format, decide its canonical MIME types, accepted extensions,
page/segment meaning, maximum input and expansion sizes, supported capabilities,
preview strategy, text extraction and OCR behavior, and behavior in both
clients. Then implement and test the API and worker adapters, wire supported
upload paths, and register each adapter in its process registry. Add capability
tests that prove unsupported actions stay unavailable.

For a new rollout, deploy the worker support first and the API second. The API
discovery response is what enables format-specific client uploads, so clients
won't advertise the format until the worker is ready to process it.

Do not assume every format has physical pages. Keep `pageNumber` nullable and
use stable `segmentIndex` values for search results. Avoid format checks in
shared services and UI where the descriptor/capability contract can express
the behavior.
