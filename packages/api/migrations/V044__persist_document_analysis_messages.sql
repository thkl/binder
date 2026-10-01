ALTER TABLE document_analysis_sessions
    ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb;
---
INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('ai.fileAnalysis.expirationSeconds', '3600', FALSE, 'Lifetime of uploaded PDF analysis files in seconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.fileAnalysis.timeoutMs', '120000', FALSE, 'Maximum duration of a PDF analysis request in milliseconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
