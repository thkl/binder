ALTER TABLE inbox_items
    ADD COLUMN IF NOT EXISTS ai_auto_applied BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('ai.automaticClassification.enabled', 'false', FALSE, 'Automatically apply high-confidence AI metadata suggestions when fields are empty', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.automaticClassification.confidence', '0.8', FALSE, 'Minimum AI confidence from 0 to 1 required for automatic classification', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
