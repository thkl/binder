# AI assistance

AI title suggestions are optional and explicitly user-triggered. The API sends the original filename and a bounded amount of extracted text to the configured OpenAI-compatible chat endpoint. The existing document title is never changed automatically.

The client displays the proposed title with accept and dismiss actions. Accepting uses the normal ownership-checked title update endpoint; dismissing makes no database change.

Configuration is stored in the database. The provider and API key are shared by assistant and embedding workloads. Their endpoints and models remain separate. The API key is encrypted with `ENCRYPTION_KEY`:

- `ai.titleSuggestions.enabled`
- `ai.provider`
- `ai.endpoint` / `ai.model` for assistant requests
- `ai.apiKey` for both assistant and embedding requests
- `ai.documentAnalysis.prompt` for the user-editable document analysis instructions
- `embeddings.endpoint` / `embeddings.model` for embedding requests

The default is disabled. Logs include document UUID, model, and text length, but never document text, prompts, API keys, or generated vectors.

The analysis prompt is editable by administrators in the AI assistance settings. The API appends the required JSON shape, UUID allow-list rules, and title length constraint after the editable text, then validates and sanitizes the response against the current vocabulary and metadata definitions. This keeps customization useful without allowing an edited prompt to bypass server-side safety and data validation.

## P3 provider profiles

The current configuration uses one shared provider and API key for assistant and embedding requests. A planned P3 extension will replace this with a list of named provider profiles. Each profile will contain its own endpoint, encrypted credentials, and task-specific model settings. Embeddings and assistant requests will then select their provider independently.
