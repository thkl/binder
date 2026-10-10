CREATE TABLE IF NOT EXISTS document_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_shares_not_self CHECK (owner_id <> recipient_user_id),
    CONSTRAINT document_shares_document_recipient_unique UNIQUE (document_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS document_shares_recipient_idx
    ON document_shares (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_shares_owner_document_idx
    ON document_shares (owner_id, document_id);

CREATE TABLE IF NOT EXISTS folder_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT folder_shares_not_self CHECK (owner_id <> recipient_user_id),
    CONSTRAINT folder_shares_folder_recipient_unique UNIQUE (folder_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS folder_shares_recipient_idx
    ON folder_shares (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS folder_shares_owner_folder_idx
    ON folder_shares (owner_id, folder_id);
