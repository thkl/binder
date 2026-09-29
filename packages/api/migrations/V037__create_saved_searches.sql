CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    search_type VARCHAR(32) NOT NULL CHECK (search_type IN ('list', 'semantic')),
    definition JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_searches_owner_name_idx
    ON saved_searches (owner_id, lower(name));

CREATE INDEX IF NOT EXISTS saved_searches_owner_created_idx
    ON saved_searches (owner_id, created_at DESC);
