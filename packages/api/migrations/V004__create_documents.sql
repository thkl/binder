CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    checksum_sha256 CHAR(64) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT documents_status_check CHECK (status IN ('uploaded', 'scanning', 'processing', 'ready', 'failed')),
    CONSTRAINT documents_storage_key_unique UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS documents_owner_created_idx
    ON documents (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_status_idx
    ON documents (status);

