INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    (
        'ai.automaticAnalysis.enabled',
        'false',
        FALSE,
        'Automatically analyze imported documents after text extraction',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT (key) DO NOTHING;
