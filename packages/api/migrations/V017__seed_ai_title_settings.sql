INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('ai.titleSuggestions.enabled', 'false', FALSE, 'Allow hosted AI title suggestions after manual request', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.provider', 'openai-compatible', FALSE, 'AI provider adapter', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.endpoint', 'https://api.openai.com/v1/chat/completions', FALSE, 'Hosted AI chat completion endpoint', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.model', 'gpt-4o-mini', FALSE, 'Hosted AI model used for title suggestions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ai.apiKey', '', TRUE, 'Encrypted API key for AI assistance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
