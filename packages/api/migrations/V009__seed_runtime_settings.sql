INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('documents.storageRoot', 'storage', FALSE, 'Document storage path relative to APP_ROOT_PATH', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('documents.maxUploadBytes', '52428800', FALSE, 'Maximum uploaded document size in bytes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('pipeline.pollIntervalMs', '2000', FALSE, 'Worker polling interval in milliseconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('pipeline.lockTimeoutMs', '900000', FALSE, 'Time before a running job is considered stale', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('pipeline.reconcileIntervalMs', '30000', FALSE, 'Interval for finding uploaded documents without jobs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
