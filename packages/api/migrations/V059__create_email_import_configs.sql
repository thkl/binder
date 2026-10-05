CREATE TABLE email_import_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    host VARCHAR(255) NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 993 CHECK (port BETWEEN 1 AND 65535),
    secure BOOLEAN NOT NULL DEFAULT TRUE,
    username VARCHAR(320) NOT NULL DEFAULT '',
    password TEXT,
    password_iv VARCHAR(32),
    mailbox VARCHAR(255) NOT NULL DEFAULT 'INBOX',
    poll_interval_ms INTEGER NOT NULL DEFAULT 900000 CHECK (poll_interval_ms BETWEEN 60000 AND 86400000),
    delete_after_import BOOLEAN NOT NULL DEFAULT FALSE,
    trusted_senders JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_polled_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((password IS NULL AND password_iv IS NULL) OR (password IS NOT NULL AND password_iv IS NOT NULL))
);

CREATE INDEX email_import_configs_enabled_idx ON email_import_configs(enabled);
