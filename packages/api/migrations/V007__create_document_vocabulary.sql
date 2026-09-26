CREATE TABLE IF NOT EXISTS document_types (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_categories (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id),
    parent_id UUID REFERENCES document_categories(id),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_tags (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_tag_assignments (
    document_id UUID NOT NULL REFERENCES documents(id),
    tag_id UUID NOT NULL REFERENCES document_tags(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, tag_id)
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type_id UUID REFERENCES document_types(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES document_categories(id);

CREATE INDEX IF NOT EXISTS document_types_owner_idx ON document_types (owner_id, active, name);
CREATE INDEX IF NOT EXISTS document_categories_owner_idx ON document_categories (owner_id, active, name);
CREATE INDEX IF NOT EXISTS document_tags_owner_idx ON document_tags (owner_id, active, name);
CREATE INDEX IF NOT EXISTS document_tag_assignments_tag_idx ON document_tag_assignments (tag_id, document_id);
