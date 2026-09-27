# Controlled document metadata

Document classification uses controlled vocabularies instead of free-form AI-generated labels.

## Vocabulary scopes

- System entries have a `null` owner and are visible to every authenticated user.
- Personal entries belong to one user and are visible only to that user.
- Administrators may create system entries.
- Regular users may create personal entries.
- Entries are deactivated rather than removed so existing document assignments remain valid.

## API

```text
GET  /api/v1/metadata/vocabulary
POST /api/v1/metadata/vocabulary/document-types
POST /api/v1/metadata/vocabulary/categories
POST /api/v1/metadata/vocabulary/tags
GET  /api/v1/metadata/definitions
POST /api/v1/metadata/definitions

GET  /api/v1/documents/:uuid/metadata
POST /api/v1/documents/:uuid/metadata
POST /api/v1/documents/:uuid/title
GET  /api/v1/documents/:uuid/extracted-text
```

Document titles are editable presentation metadata; the original filename remains immutable for audit and storage purposes.

The extracted text endpoint is ownership-protected and returns the combined text plus page boundaries. The metadata editor loads it lazily in a second tab next to the thumbnail so users can copy text such as issuer details without increasing the initial metadata-panel request cost.

The document metadata endpoint accepts document type, category, tag UUIDs, and a `custom` object. Every vocabulary UUID and custom field key is checked against the active system or personal metadata available to the authenticated owner.

Custom metadata definitions have a stable `key`, display `label`, `type`, optional `options`, and `unique`/`mandatory` flags. Supported types are `text`, `number`, `date`, `datetime`, `boolean`, `select`, and `multi-select`. Values are stored as JSON per document, so new fields do not require a table migration. The client exposes personal definitions and renders the corresponding controls in the document editor.

Tags remain controlled vocabulary values, but the document editor provides search and inline creation of a personal tag. This keeps AI classification bounded to known UUIDs while allowing users to extend their own vocabulary at the point of use.

AI classification will later receive this same allowed vocabulary and must return existing UUIDs. The API will reject unknown or inaccessible UUIDs; AI processing must never create vocabulary entries automatically.
