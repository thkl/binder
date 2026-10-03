CREATE TABLE IF NOT EXISTS document_classification_feedback (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    fingerprint VARCHAR(64) NOT NULL,
    field VARCHAR(32) NOT NULL,
    value_id UUID NOT NULL,
    previous_value_id UUID NULL,
    match_count INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_matched_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_classification_feedback_field_check
      CHECK (field IN ('documentType', 'category', 'issuer', 'tag')),
    CONSTRAINT document_classification_feedback_match_count_check
      CHECK (match_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_classification_feedback_unique_rule_idx
    ON document_classification_feedback (owner_id, fingerprint, field, value_id);

CREATE INDEX IF NOT EXISTS document_classification_feedback_lookup_idx
    ON document_classification_feedback (owner_id, fingerprint, active, field, match_count DESC);

CREATE INDEX IF NOT EXISTS document_classification_feedback_source_idx
    ON document_classification_feedback (source_document_id);
