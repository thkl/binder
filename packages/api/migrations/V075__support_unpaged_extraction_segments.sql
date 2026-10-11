ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS segment_index INTEGER;
UPDATE document_pages SET segment_index = page_number WHERE segment_index IS NULL;
ALTER TABLE document_pages ALTER COLUMN segment_index SET NOT NULL;
ALTER TABLE document_pages ALTER COLUMN page_number DROP NOT NULL;
ALTER TABLE document_pages
    ADD CONSTRAINT document_pages_document_segment_unique UNIQUE (document_id, segment_index);
CREATE INDEX IF NOT EXISTS document_pages_segment_idx
    ON document_pages (document_id, segment_index);

ALTER TABLE document_embeddings ADD COLUMN IF NOT EXISTS segment_index INTEGER;
UPDATE document_embeddings SET segment_index = page_number WHERE segment_index IS NULL;
ALTER TABLE document_embeddings ALTER COLUMN segment_index SET NOT NULL;
ALTER TABLE document_embeddings ALTER COLUMN page_number DROP NOT NULL;
ALTER TABLE document_embeddings
    ADD CONSTRAINT document_embeddings_segment_chunk_unique
    UNIQUE (document_id, segment_index, chunk_index);
CREATE INDEX IF NOT EXISTS document_embeddings_segment_idx
    ON document_embeddings (document_id, segment_index, chunk_index);

ALTER TABLE documents ALTER COLUMN page_count DROP NOT NULL;
