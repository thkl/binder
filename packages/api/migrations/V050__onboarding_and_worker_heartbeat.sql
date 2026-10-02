ALTER TABLE setup_state
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pipeline_worker_heartbeats (
    worker_id VARCHAR(255) PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    version VARCHAR(100) NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS pipeline_worker_heartbeats_last_seen_idx
    ON pipeline_worker_heartbeats (last_seen_at);
