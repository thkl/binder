CREATE TABLE IF NOT EXISTS maintenance_runs (
    id UUID PRIMARY KEY,
    job_key VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    artifact_name VARCHAR(255),
    size_bytes BIGINT,
    deleted_files INTEGER,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT maintenance_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS maintenance_runs_job_created_idx
    ON maintenance_runs (job_key, created_at DESC);

CREATE INDEX IF NOT EXISTS maintenance_runs_status_idx
    ON maintenance_runs (status, created_at DESC);
