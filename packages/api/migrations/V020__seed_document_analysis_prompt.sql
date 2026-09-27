INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES (
    'ai.documentAnalysis.prompt',
    'Classify the document and create a concise human-readable title. Use only the supplied document types, categories, tags, and metadata keys. Never invent UUIDs, tags, types, categories, or custom keys. Use null or [] when uncertain. Return only the requested JSON object; never include markdown.',
    FALSE,
    'Instructions used for the one-call document title and metadata analysis',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;
