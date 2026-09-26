ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS thumbnail_key VARCHAR(500);

