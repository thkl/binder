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

GET  /api/v1/documents/:uuid/metadata
POST /api/v1/documents/:uuid/metadata
```

The document metadata endpoint accepts document type, category, and tag UUIDs. Every UUID is checked against the active system or personal vocabulary available to the authenticated owner.

AI classification will later receive this same allowed vocabulary and must return existing UUIDs. The API will reject unknown or inaccessible UUIDs; AI processing must never create vocabulary entries automatically.
