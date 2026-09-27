CREATE TABLE IF NOT EXISTS inbox_items (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    checksum_sha256 VARCHAR(64),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    ai_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    ai_suggestion JSONB,
    last_error VARCHAR(2000),
    ai_error VARCHAR(2000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT inbox_items_status_check CHECK (status IN ('new', 'processing', 'imported', 'duplicate', 'rejected', 'failed')),
    CONSTRAINT inbox_items_ai_status_check CHECK (ai_status IN ('pending', 'processing', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS inbox_items_owner_created_idx
    ON inbox_items (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inbox_items_status_idx
    ON inbox_items (status, ai_status);
