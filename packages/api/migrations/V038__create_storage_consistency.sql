CREATE TABLE IF NOT EXISTS document_storage_issues (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    issue_type VARCHAR(32) NOT NULL CHECK (issue_type IN ('missing', 'size-mismatch', 'checksum-mismatch', 'unreadable')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('open', 'resolved')),
    expected_size_bytes BIGINT NOT NULL,
    actual_size_bytes BIGINT,
    expected_checksum_sha256 VARCHAR(64) NOT NULL,
    actual_checksum_sha256 VARCHAR(64),
    details VARCHAR(1000) NOT NULL,
    first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS document_storage_issues_owner_status_idx
    ON document_storage_issues (owner_id, status, last_detected_at DESC);

ALTER TABLE maintenance_runs ADD COLUMN IF NOT EXISTS checked_files INTEGER;
ALTER TABLE maintenance_runs ADD COLUMN IF NOT EXISTS issue_count INTEGER;

INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('maintenance.storageConsistency.enabled', 'true', FALSE, 'Run a scheduled consistency check for document files', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('maintenance.storageConsistency.schedule', '0 3 * * *', FALSE, 'Five-field cron schedule for the document storage consistency check', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
