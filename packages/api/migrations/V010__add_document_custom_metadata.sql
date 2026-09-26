ALTER TABLE documents ADD COLUMN IF NOT EXISTS title VARCHAR(255);

UPDATE documents
SET title = original_filename
WHERE title IS NULL;

CREATE TABLE IF NOT EXISTS metadata_definitions (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id),
    key VARCHAR(100) NOT NULL,
    label VARCHAR(150) NOT NULL,
    type VARCHAR(32) NOT NULL,
    options JSONB,
    is_unique BOOLEAN NOT NULL DEFAULT FALSE,
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT metadata_definitions_type_check CHECK (type IN ('text', 'number', 'date', 'datetime', 'boolean', 'select', 'multi-select'))
);

CREATE TABLE IF NOT EXISTS document_metadata_values (
    document_id UUID NOT NULL REFERENCES documents(id),
    definition_id UUID NOT NULL REFERENCES metadata_definitions(id),
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, definition_id)
);

CREATE INDEX IF NOT EXISTS metadata_definitions_owner_idx ON metadata_definitions (owner_id, active, label);
CREATE INDEX IF NOT EXISTS document_metadata_values_definition_idx ON document_metadata_values (definition_id, document_id);
