ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
    ADD CONSTRAINT documents_status_check
    CHECK (status IN ('uploaded', 'scanning', 'processing', 'ready', 'failed', 'quarantined'));

ALTER TABLE pipeline_jobs
    DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;

ALTER TABLE pipeline_jobs
    ADD CONSTRAINT pipeline_jobs_kind_check
    CHECK (kind IN ('malware-scan', 'thumbnail', 'text-extraction', 'ocr', 'embedding'));

INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('security.malwareScan.required', 'true', FALSE, 'Require a successful malware scan before document processing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('security.malwareScan.command', 'clamdscan', FALSE, 'Executable used by the worker to scan documents', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('security.malwareScan.timeoutMs', '120000', FALSE, 'Maximum malware scan duration in milliseconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
