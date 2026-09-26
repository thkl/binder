CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE document_embeddings
    ADD COLUMN IF NOT EXISTS embedding_vector vector;

UPDATE document_embeddings
SET embedding_vector = embedding::text::vector
WHERE embedding_vector IS NULL;

CREATE INDEX IF NOT EXISTS document_embeddings_vector_idx
    ON document_embeddings USING hnsw ((embedding_vector::vector(1536)) vector_cosine_ops)
    WHERE dimensions = 1536;
