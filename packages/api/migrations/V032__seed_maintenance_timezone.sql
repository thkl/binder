INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('maintenance.timezone', 'UTC', FALSE, 'Timezone used for scheduled maintenance jobs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
