CREATE TABLE IF NOT EXISTS issuers (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    address VARCHAR(255),
    zip_code VARCHAR(32),
    city VARCHAR(150),
    country VARCHAR(100),
    custom JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS issuers_owner_name_idx ON issuers (owner_id, name);

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS issuer_id UUID REFERENCES issuers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_issuer_idx ON documents (issuer_id);
