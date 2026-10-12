CREATE TABLE IF NOT EXISTS metadata_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_event_id UUID NOT NULL UNIQUE,
    field VARCHAR(200) NOT NULL,
    operator VARCHAR(16) NOT NULL,
    trigger_value VARCHAR(500) NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP(6) WITH TIME ZONE,
    last_error VARCHAR(500),
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS metadata_webhook_deliveries_pending_idx
    ON metadata_webhook_deliveries(available_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS metadata_webhook_deliveries_created_idx
    ON metadata_webhook_deliveries(created_at DESC);
