INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    (
        'mailer.smtp.enabled',
        'false',
        FALSE,
        'Enable SMTP for password reset and other outbound email',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.host',
        '',
        FALSE,
        'SMTP server hostname',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.port',
        '587',
        FALSE,
        'SMTP server port',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.secure',
        'false',
        FALSE,
        'Use a secure SMTP connection',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.username',
        '',
        FALSE,
        'SMTP authentication username',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.password',
        '',
        FALSE,
        'SMTP authentication password; encrypted after configuration',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.fromAddress',
        '',
        FALSE,
        'Default sender email address',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.smtp.fromName',
        'Binder',
        FALSE,
        'Default sender display name',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.enabled',
        'false',
        FALSE,
        'Enable mailbox polling for document import',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.host',
        '',
        FALSE,
        'IMAP server hostname',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.port',
        '993',
        FALSE,
        'IMAP server port',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.secure',
        'true',
        FALSE,
        'Use a secure IMAP connection',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.username',
        '',
        FALSE,
        'IMAP authentication username',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.password',
        '',
        FALSE,
        'IMAP authentication password; encrypted after configuration',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.mailbox',
        'INBOX',
        FALSE,
        'Mailbox to poll for document messages',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.importOwnerUuid',
        '',
        FALSE,
        'Owner assigned to documents imported from email',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.pollIntervalMs',
        '60000',
        FALSE,
        'Mailbox polling interval in milliseconds',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'mailer.imap.deleteAfterImport',
        'false',
        FALSE,
        'Delete a message after all supported attachments are imported',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT (key) DO NOTHING;
