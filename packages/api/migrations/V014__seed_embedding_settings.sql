INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('embeddings.enabled', 'false', FALSE, 'Allow document text to be sent to the configured hosted embedding provider', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.provider', 'openai-compatible', FALSE, 'Embedding provider adapter', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.endpoint', 'https://api.openai.com/v1/embeddings', FALSE, 'Hosted embedding API endpoint', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.model', 'text-embedding-3-small', FALSE, 'Hosted embedding model', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.apiKey', '', TRUE, 'Encrypted API key for the embedding provider', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.chunkSize', '1200', FALSE, 'Maximum embedding chunk size in characters', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('embeddings.chunkOverlap', '200', FALSE, 'Embedding chunk overlap in characters', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
