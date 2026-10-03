INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES (
    'documents.reviewState.clearOn',
    'metadata',
    FALSE,
    'Clear the new-document marker after metadata/title save or after the first document opening',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;
