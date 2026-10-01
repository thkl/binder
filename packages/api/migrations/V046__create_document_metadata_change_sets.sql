CREATE TABLE IF NOT EXISTS document_metadata_change_sets (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    policy VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'applied',
    document_count INTEGER NOT NULL,
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rolled_back_at TIMESTAMPTZ,
    rolled_back_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT document_metadata_change_sets_policy_check
        CHECK (policy IN ('fill-empty', 'skip-existing', 'replace-selected')),
    CONSTRAINT document_metadata_change_sets_status_check
        CHECK (status IN ('applied', 'rolled-back'))
);

CREATE INDEX IF NOT EXISTS document_metadata_change_sets_owner_created_idx
    ON document_metadata_change_sets (owner_id, created_at DESC);

ALTER TABLE document_audit_events
    ADD COLUMN IF NOT EXISTS change_set_id UUID REFERENCES document_metadata_change_sets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_audit_events_change_set_idx
    ON document_audit_events (change_set_id);
