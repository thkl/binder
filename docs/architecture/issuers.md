# Issuers

Issuers are reusable, owner-scoped records referenced by documents through `documents.issuer_id`. This keeps issuer search and filtering reliable without copying sender text into every document.

## Stored fields

- `name` — required canonical issuer name
- `address`, `zip_code`, `city`, `country` — optional common address fields
- `custom` — JSON object for additional user-defined issuer fields

Issuers are only visible to their owner. The document metadata editor can create, select, and update an issuer. Updating an issuer updates the shared record for all documents that reference it.

## Worker matching

After text extraction and OCR, the worker compares normalized extracted text with the owner’s existing issuers. A match requires the issuer name and receives additional confidence for matching address fields and string-valued custom fields. Names found only in payment or banking context (`IBAN`, `BIC`, bank details, and similar footer text) are not enough to assign an issuer; the name must appear in the document identity area or be supported by an independently matched non-financial field. The worker assigns an issuer only when the best candidate clears the confidence threshold and is clearly ahead of the runner-up; it never overwrites an existing issuer assignment.

This is intentionally deterministic and local. It does not create issuer records and does not use an LLM. Unmatched or ambiguous documents remain editable in the client.

## API surface

- `GET /api/v1/issuers` — list the authenticated user’s issuers, optionally filtered by name with `q`
- `POST /api/v1/issuers` — create an issuer
- `PATCH /api/v1/issuers/:uuid` — update an owned issuer
- `POST /api/v1/documents/:uuid/metadata` — assign or clear `issuerUuid`
- document list/search queries accept `issuerUuid`

Migration `V024__create_issuers.sql` creates the issuer table and nullable document reference.
