INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('backup.root', '/app/backup', FALSE, 'Absolute path for PostgreSQL backup files. Change this for the deployment.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
