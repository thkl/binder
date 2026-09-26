CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id),
    owner_id UUID NOT NULL REFERENCES users(id),
    kind VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(255),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pipeline_jobs_kind_check CHECK (kind IN ('thumbnail', 'text-extraction', 'ocr', 'embedding')),
    CONSTRAINT pipeline_jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS pipeline_jobs_claim_idx
    ON pipeline_jobs (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS pipeline_jobs_document_idx
    ON pipeline_jobs (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_job_events (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES pipeline_jobs(id),
    type VARCHAR(100) NOT NULL,
    message VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pipeline_job_events_job_idx
    ON pipeline_job_events (job_id, created_at ASC);
