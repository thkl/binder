ALTER TABLE documents
  ADD COLUMN version_family_id uuid,
  ADD COLUMN version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN version_parent_id uuid;

UPDATE documents
SET version_family_id = id
WHERE version_family_id IS NULL;

ALTER TABLE documents
  ADD CONSTRAINT documents_version_family_check CHECK (version_family_id IS NOT NULL),
  ADD CONSTRAINT documents_version_number_check CHECK (version_number >= 1),
  ADD CONSTRAINT documents_version_parent_fk
    FOREIGN KEY (version_parent_id) REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX documents_owner_version_family_idx
  ON documents (owner_id, version_family_id, version_number);
