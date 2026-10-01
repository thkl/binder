CREATE TABLE IF NOT EXISTS document_audit_events (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type VARCHAR(16) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_audit_events_actor_type_check CHECK (actor_type IN ('user', 'worker', 'system'))
);

CREATE INDEX IF NOT EXISTS document_audit_events_document_created_idx
    ON document_audit_events (document_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS document_audit_events_owner_created_idx
    ON document_audit_events (owner_id, created_at DESC);

INSERT INTO document_audit_events (
    id,
    document_id,
    owner_id,
    actor_id,
    actor_type,
    event_type,
    summary,
    details,
    created_at
)
SELECT
    md5(document.id::text || ':audit-history-migration')::uuid,
    d.id,
    d.owner_id,
    NULL,
    'system',
    'uploaded',
    'Document imported before audit history was enabled',
    '{"source":"audit-history-migration"}'::jsonb,
    d.created_at
FROM documents AS d
WHERE NOT EXISTS (
    SELECT 1
    FROM document_audit_events AS existing
    WHERE existing.document_id = d.id
);
