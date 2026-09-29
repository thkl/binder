# Saved searches

Saved searches are named, owner-scoped search definitions. They preserve the
search state without duplicating the document-search implementation.

## Supported definitions

- `list` stores document-list filters, folder scope, grouping, sorting, and
  page size.
- `semantic` stores the natural-language query, metadata filters, result limit,
  semantic score threshold, and whether the client shows only semantic hits.

The definitions are validated with the shared Zod schemas in
`packages/common`. The semantic score threshold is passed to the API and used
by the semantic search service when the saved search is loaded.

## Ownership and API

Every saved search belongs to its authenticated user. The API never lists,
updates, or deletes a saved search outside that owner scope.

- `GET /api/v1/saved-searches`
- `POST /api/v1/saved-searches`
- `PATCH /api/v1/saved-searches/:uuid`
- `DELETE /api/v1/saved-searches/:uuid`

Names are unique per owner, case-insensitively. Deleting a saved search does
not affect documents or metadata.

## Client behavior

The document list and natural-language search each show the saved searches
that match their definition type. A user can save, load, rename, and delete a
search. Loading a list search restores its filters and organization state;
loading a semantic search restores its query, filters, and score threshold.
