ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS ai_suggestion JSONB;
