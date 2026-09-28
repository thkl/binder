CREATE TABLE IF NOT EXISTS maintenance_requests (
    id UUID PRIMARY KEY,
    job_key VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT maintenance_requests_job_check CHECK (job_key IN ('backup'))
);

CREATE INDEX IF NOT EXISTS maintenance_requests_job_created_idx
    ON maintenance_requests (job_key, created_at ASC);
