UPDATE settings
SET value = 'Classify the document and create a concise human-readable title. Use only the supplied document types, categories, tags, and metadata keys. Never invent UUIDs, tags, types, categories, or custom keys. Use null or [] when uncertain. Return only the requested JSON object; never include markdown. For confidence, return a JSON number from 0 to 1 based on the evidence in the document. Use 0 only when there is no useful evidence and do not return a percentage.',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'ai.documentAnalysis.prompt'
  AND value = 'Classify the document and create a concise human-readable title. Use only the supplied document types, categories, tags, and metadata keys. Never invent UUIDs, tags, types, categories, or custom keys. Use null or [] when uncertain. Return only the requested JSON object; never include markdown.';
