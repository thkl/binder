INSERT INTO settings (key, value, is_encrypted, description)
VALUES
    ('documents.storageRoot', 'storage', FALSE, 'Document storage path relative to APP_ROOT_PATH'),
    ('documents.maxUploadBytes', '52428800', FALSE, 'Maximum uploaded document size in bytes'),
    ('pipeline.pollIntervalMs', '2000', FALSE, 'Worker polling interval in milliseconds'),
    ('pipeline.lockTimeoutMs', '900000', FALSE, 'Time before a running job is considered stale'),
    ('pipeline.reconcileIntervalMs', '30000', FALSE, 'Interval for finding uploaded documents without jobs')
ON CONFLICT (key) DO NOTHING;
