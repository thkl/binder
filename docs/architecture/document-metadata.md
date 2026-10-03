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
PATCH /api/v1/metadata/vocabulary/:kind/:uuid
GET  /api/v1/metadata/definitions
POST /api/v1/metadata/definitions
PATCH /api/v1/metadata/definitions/:uuid
DELETE /api/v1/metadata/definitions/:uuid

GET  /api/v1/documents/:uuid/metadata
POST /api/v1/documents/:uuid/metadata
POST /api/v1/documents/:uuid/title
GET  /api/v1/documents/:uuid/extracted-text
```

Document titles are editable presentation metadata; the original filename remains immutable for audit and storage purposes.

The new-document marker is controlled by the database setting
`documents.reviewState.clearOn`. The default `metadata` clears it when a user
saves metadata or a title. The `open` option clears it when the user opens the
document for the first time. Explicitly marking a document as reviewed always
clears the marker, regardless of this setting. Opening is an explicit,
ownership-protected API action so downloading a file does not mark it as read.

The extracted text endpoint is ownership-protected and returns the combined text plus page boundaries. The metadata editor loads it lazily in a second tab next to the thumbnail so users can copy text such as issuer details without increasing the initial metadata-panel request cost.

The document metadata endpoint accepts document type, category, tag UUIDs, and a `custom` object. Every vocabulary UUID and custom field key is checked against the active system or personal metadata available to the authenticated owner.

Custom metadata definitions have a stable `key`, display `label`, `type`, optional `options`, and `unique`/`mandatory` flags. Supported types are `text`, `number`, `date`, `datetime`, `boolean`, `select`, and `multi-select`. Values are stored as JSON per document, so new fields do not require a table migration. The client exposes personal definitions and renders the corresponding controls in the document editor.

Definition keys and field types are immutable after creation because changing
either would make existing document values ambiguous. The label can be edited
by the owning user or an administrator. Deletion is a soft delete: the
definition is hidden from future editing and selection, while existing values
remain in the database as intentionally orphaned historical data.

Tags remain controlled vocabulary values, but the document editor provides search and inline creation of a personal tag. This keeps AI classification bounded to known UUIDs while allowing users to extend their own vocabulary at the point of use.

Personal document types, categories, and issuers can optionally be linked to a
personal virtual folder. Saving document metadata applies those routing links
automatically, including when an AI suggestion is accepted. Workspace/system
vocabulary entries cannot target a personal folder. Routing only adds links;
manual memberships are not removed when metadata changes.

AI classification will later receive this same allowed vocabulary and must return existing UUIDs. The API will reject unknown or inaccessible UUIDs; AI processing must never create vocabulary entries automatically.

Feedback-based classification also uses this controlled vocabulary. An explicit
user correction can teach Binder how to classify a recurring document template,
such as monthly payment letters whose dates and amounts change. Feedback is
owner-scoped, records the source document and the chosen vocabulary UUID, and
is only applied automatically after a strong template match. It must never
overwrite metadata that the user has already set and remains reviewable and
removable from the metadata settings page.
