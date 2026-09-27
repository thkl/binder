INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('inbox.enabled', 'false', FALSE, 'Enable importing PDF files from the inbox folder', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('inbox.path', 'inbox', FALSE, 'Inbox path relative to the document storage root', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('inbox.importOwnerUuid', '', FALSE, 'Internal user UUID assigned to imported documents', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('inbox.pollIntervalMs', '5000', FALSE, 'Inbox polling interval in milliseconds', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('inbox.stabilityMs', '2000', FALSE, 'Minimum age of a file before it is imported', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
