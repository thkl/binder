ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 1;

UPDATE documents AS document
SET page_count = GREATEST(1, COALESCE((
    SELECT COUNT(*)
    FROM document_pages AS page
    WHERE page.document_id = document.id
), 1));
