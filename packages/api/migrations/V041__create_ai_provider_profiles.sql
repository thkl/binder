CREATE TABLE IF NOT EXISTS ai_provider_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(64) NOT NULL DEFAULT 'openai-compatible',
    assistant_endpoint VARCHAR(500),
    assistant_model VARCHAR(150),
    embedding_endpoint VARCHAR(500),
    embedding_model VARCHAR(150),
    api_key TEXT NOT NULL DEFAULT '',
    api_key_iv VARCHAR(32),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ai_provider_profiles_type_check
        CHECK (provider_type IN ('openai-compatible'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_profiles_name_lower_unique
    ON ai_provider_profiles (LOWER(name));

CREATE INDEX IF NOT EXISTS ai_provider_profiles_enabled_idx
    ON ai_provider_profiles (enabled, name);

INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('ai.assistantProviderUuid', '', FALSE, 'Selected provider profile for document assistance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.embeddingProviderUuid', '', FALSE, 'Selected provider profile for semantic embeddings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
