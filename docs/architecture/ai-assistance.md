# AI assistance

AI title suggestions are optional and explicitly user-triggered. The API sends the original filename and a bounded amount of extracted text to the configured OpenAI-compatible chat endpoint. The existing document title is never changed automatically.

The client displays the proposed title with accept and dismiss actions. Accepting uses the normal ownership-checked title update endpoint; dismissing makes no database change.

Configuration is stored in the database. The API key is encrypted with `ENCRYPTION_KEY`:

- `ai.titleSuggestions.enabled`
- `ai.provider`
- `ai.endpoint`
- `ai.model`
- `ai.apiKey`

The default is disabled. Logs include document UUID, model, and text length, but never document text, prompts, API keys, or generated vectors.
