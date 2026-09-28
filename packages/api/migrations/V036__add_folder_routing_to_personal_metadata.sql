ALTER TABLE document_types
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE document_categories
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE issuers
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_types_folder_idx ON document_types (folder_id);
CREATE INDEX IF NOT EXISTS document_categories_folder_idx ON document_categories (folder_id);
CREATE INDEX IF NOT EXISTS issuers_folder_idx ON issuers (folder_id);
