INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES (
    'inbox.completionStage',
    'ai-analysis',
    FALSE,
    'Remove successful inbox items after import or after AI analysis',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;
