# Document versions and page splitting

Document splitting is planned for P4 and is intentionally coupled to document
version families. It must not be implemented as an operation that silently
rewrites or deletes the original upload.

## Planned behavior

The first split operation will be non-destructive:

- Extract pages `X` through `Y` into a new PDF document.
- Support extracting from page `X` through the final page.
- Keep the source document and its original filesystem object unchanged.
- Link the new document to the source's version family.
- Run the normal malware, text extraction, OCR, embedding, thumbnail, and
  optional PDF/A processing for the new document.

The UI should make the source document, selected page range, and resulting
document explicit before the operation is confirmed. A future replacement
workflow may allow the user to designate one segment as the current version,
but it must remain a separate, reversible decision.

## Metadata and ownership

The derived document keeps the authenticated owner's ownership and must never
inherit access from another owner. The implementation must decide explicitly
whether each field is copied or reset:

- document type, category, issuer, tags, custom metadata, and folder links may
  be copied because they often apply to every page of a source document;
- the title should receive a clear derived suffix or be user-editable before
  saving;
- AI suggestions and extracted text must be generated for the derived PDF;
- audit history must record the source document, page range, actor, and new
  document UUID.

## API direction

The operation should use a versioned, owner-scoped document endpoint with a
shared Zod request and response contract. Page numbers are one-based and the
API must reject empty ranges, reversed ranges, and pages outside the source
document's known page count.

The source file remains under its existing storage key. The extracted PDF gets
its own document UUID and normal storage key; no client-provided filesystem
path is accepted.
