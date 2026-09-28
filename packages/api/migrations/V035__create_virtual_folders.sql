CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    sort_position INTEGER NOT NULL DEFAULT 0 CHECK (sort_position >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS folders_owner_parent_sort_idx
    ON folders (owner_id, parent_id, sort_position, name);

CREATE UNIQUE INDEX IF NOT EXISTS folders_owner_parent_name_idx
    ON folders (owner_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE IF NOT EXISTS document_folders (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, folder_id)
);

CREATE INDEX IF NOT EXISTS document_folders_folder_document_idx
    ON document_folders (folder_id, document_id);

CREATE INDEX IF NOT EXISTS document_folders_document_folder_idx
    ON document_folders (document_id, folder_id);
