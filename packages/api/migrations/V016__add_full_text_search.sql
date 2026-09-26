ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(original_filename, ''))
    ) STORED;

ALTER TABLE document_pages
    ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(text, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS documents_search_vector_idx
    ON documents USING gin (search_vector);

CREATE INDEX IF NOT EXISTS document_pages_search_vector_idx
    ON document_pages USING gin (search_vector);
