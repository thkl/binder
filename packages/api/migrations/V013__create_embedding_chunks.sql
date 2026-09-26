CREATE TABLE IF NOT EXISTS document_embeddings (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    embedding JSONB NOT NULL,
    provider VARCHAR(100) NOT NULL,
    model VARCHAR(200) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_embeddings_chunk_unique UNIQUE (document_id, page_number, chunk_index)
);
CREATE INDEX IF NOT EXISTS document_embeddings_document_idx ON document_embeddings (document_id, page_number, chunk_index);
