INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('calendar.enabled', 'false', FALSE, 'Create iCalendar events from document due-date metadata', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('calendar.dueDateField', 'dueDate', FALSE, 'Custom metadata key containing an ISO due date', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
