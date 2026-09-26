UPDATE settings AS target
SET value = source.value,
    is_encrypted = source.is_encrypted,
    value_iv = source.value_iv,
    updated_at = CURRENT_TIMESTAMP
FROM settings AS source
WHERE target.key = 'ai.apiKey'
  AND target.value = ''
  AND source.key = 'embeddings.apiKey'
  AND source.value <> '';

UPDATE settings AS target
SET value = source.value,
    updated_at = CURRENT_TIMESTAMP
FROM settings AS source
WHERE target.key = 'ai.provider'
  AND target.value = 'openai-compatible'
  AND source.key = 'embeddings.provider'
  AND source.value <> '';
