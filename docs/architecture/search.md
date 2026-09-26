# Document search

## Current implementation

The worker stores extracted text per page in PostgreSQL through the `document_pages` Sequelize model. The filesystem artifacts remain the source for regeneration:

```text
derived/<document-uuid>/ocr.pdf
derived/<document-uuid>/extracted.txt
```

The authenticated API exposes a first exact-text search endpoint:

```text
GET /api/v1/documents/search?q=car+inspection&limit=20
```

Search is ownership-scoped and currently checks document titles, original filenames, and page text. Results contain the document, a page number when the match is in extracted text, a bounded snippet, and the match type.

The client home page provides the primary search surface. The response contract is deliberately independent of the search implementation so semantic and hybrid ranking can be added behind the same UI later.

## Next evolution

- Add PostgreSQL full-text indexes and ranked `tsvector` search for larger archives.
- Add metadata and tag filters.
- Add semantic/vector candidates and hybrid ranking.
- Include match explanations and page-level highlighting.

Search must always scope candidates by the authenticated document owner before returning results.
