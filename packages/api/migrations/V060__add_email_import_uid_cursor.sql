ALTER TABLE email_import_configs
    ADD COLUMN last_uid_validity VARCHAR(40),
    ADD COLUMN last_message_uid VARCHAR(40);
