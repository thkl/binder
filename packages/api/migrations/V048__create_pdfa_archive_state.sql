ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS archive_key VARCHAR(500),
    ADD COLUMN IF NOT EXISTS archive_status VARCHAR(32) NOT NULL DEFAULT 'not-requested',
    ADD COLUMN IF NOT EXISTS archive_error VARCHAR(2000);

ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_archive_status_check;

ALTER TABLE documents
    ADD CONSTRAINT documents_archive_status_check
    CHECK (archive_status IN ('not-requested', 'queued', 'processing', 'ready', 'failed'));

INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES (
    'documents.pdfa.enabled',
    'false',
    FALSE,
    'Automatically create validated PDF/A-2b archive derivatives',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;
