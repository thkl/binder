# Document search

## Current implementation

The worker stores extracted text per page in PostgreSQL through the `document_pages` Sequelize model. The filesystem artifacts remain the source for regeneration:

```text
derived/<document-uuid>/ocr.pdf
derived/<document-uuid>/extracted.txt
```

The authenticated API exposes a hybrid search endpoint:

```text
GET /api/v1/documents/search?q=car+inspection&limit=20
```

Search is ownership-scoped and checks document titles, original filenames, and page text with PostgreSQL `tsvector`/GIN indexes. When hosted embeddings are enabled, the query is embedded with the configured provider and compared with stored document chunks using cosine similarity. Results contain the document, a page number, a bounded snippet, and the match type (`title`, `text`, or `semantic`). If embeddings are disabled or unavailable, full-text search continues to work.

The client home page provides the primary search surface. The response contract is deliberately independent of the search implementation so semantic and hybrid ranking can be added behind the same UI later.

## Current extensions

- Add expression indexes for additional embedding dimensions if other models are used.
- Include match explanations and page-level highlighting.

Document titles are searchable independently from original filenames. A future AI metadata step may suggest a cleaner title for filenames such as `01_2026_blabla.pdf`; the suggestion must be presented for manual confirmation before saving.

Search must always scope candidates by the authenticated document owner before returning results.
