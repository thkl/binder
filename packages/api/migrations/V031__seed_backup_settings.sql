INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('backup.enabled', 'false', FALSE, 'Enable scheduled PostgreSQL backups', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('backup.schedule', '0 2 * * *', FALSE, 'Five-field cron schedule for backups', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('backup.retentionDays', '30', FALSE, 'Number of days to retain backup files', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
