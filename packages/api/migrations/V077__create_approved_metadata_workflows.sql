CREATE TABLE IF NOT EXISTS metadata_webhook_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    field VARCHAR(200) NOT NULL,
    operator VARCHAR(16) NOT NULL CHECK (operator IN ('equals', 'not-equals', 'contains', 'is-set', 'is-not-set')),
    value VARCHAR(500) NOT NULL DEFAULT '',
    url VARCHAR(2048) NOT NULL,
    bearer_token TEXT,
    bearer_token_iv VARCHAR(64),
    payload_template TEXT NOT NULL,
    approval_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP(6) WITH TIME ZONE,
    review_note VARCHAR(500),
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS metadata_webhook_workflows_owner_created_idx
    ON metadata_webhook_workflows(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS metadata_webhook_workflows_approval_idx
    ON metadata_webhook_workflows(approval_status, created_at ASC);

WITH saved_config AS (
    SELECT
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.enabled') AS enabled,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.name') AS name,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.field') AS field,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.operator') AS operator,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.value') AS condition_value,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.url') AS url,
        MAX(value) FILTER (WHERE key = 'workflow.metadataWebhook.payloadTemplate') AS payload_template
    FROM settings
    WHERE key LIKE 'workflow.metadataWebhook.%'
), first_admin AS (
    SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC, id ASC LIMIT 1
)
INSERT INTO metadata_webhook_workflows (
    owner_id,
    name,
    enabled,
    field,
    operator,
    value,
    url,
    bearer_token,
    bearer_token_iv,
    payload_template,
    approval_status,
    reviewed_by,
    reviewed_at
)
SELECT
    first_admin.id,
    COALESCE(NULLIF(saved_config.name, ''), 'Migrated metadata webhook'),
    TRUE,
    COALESCE(NULLIF(saved_config.field, ''), 'issuer'),
    COALESCE(NULLIF(saved_config.operator, ''), 'equals'),
    COALESCE(saved_config.condition_value, ''),
    saved_config.url,
    token.value,
    token.value_iv,
    COALESCE(NULLIF(saved_config.payload_template, ''), '{"event":"document.metadata-condition-matched","document":{"uuid":"{{document.uuid}}","title":"{{document.title}}"}}'),
    'approved',
    first_admin.id,
    CURRENT_TIMESTAMP
FROM saved_config
CROSS JOIN first_admin
LEFT JOIN settings AS token ON token.key = 'workflow.metadataWebhook.bearerToken'
WHERE saved_config.enabled = 'true'
  AND COALESCE(saved_config.url, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM metadata_webhook_workflows);

ALTER TABLE metadata_webhook_deliveries
    ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES metadata_webhook_workflows(id) ON DELETE CASCADE;

ALTER TABLE metadata_webhook_deliveries
    DROP CONSTRAINT IF EXISTS metadata_webhook_deliveries_source_event_id_key;

ALTER TABLE metadata_webhook_deliveries
    DROP CONSTRAINT IF EXISTS metadata_webhook_deliveries_status_check;

ALTER TABLE metadata_webhook_deliveries
    ADD CONSTRAINT metadata_webhook_deliveries_status_check
    CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS metadata_webhook_deliveries_event_workflow_idx
    ON metadata_webhook_deliveries(source_event_id, workflow_id);

CREATE INDEX IF NOT EXISTS metadata_webhook_deliveries_workflow_created_idx
    ON metadata_webhook_deliveries(workflow_id, created_at DESC);
