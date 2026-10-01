# AI assistance

AI title suggestions are optional and explicitly user-triggered. The API sends the original filename and a bounded amount of extracted text to the configured OpenAI-compatible chat endpoint. The existing document title is never changed automatically.

The client displays the proposed title with accept and dismiss actions. Accepting uses the normal ownership-checked title update endpoint; dismissing makes no database change.

Configuration is stored in the database. Named provider profiles hold task-specific endpoints and models. Each profile API key is encrypted with `ENCRYPTION_KEY`:

- `ai.titleSuggestions.enabled`
- `ai.documentAnalysis.prompt` for the user-editable document analysis instructions
- `ai.assistantProviderUuid` for document assistance
- `ai.embeddingProviderUuid` for semantic embeddings
- `embeddings.enabled`, `embeddings.chunkSize`, and `embeddings.chunkOverlap`

The default is disabled. Logs include document UUID, model, and text length, but never document text, prompts, API keys, or generated vectors.

The analysis prompt is editable by administrators in the AI assistance settings. The API appends the required JSON shape, UUID allow-list rules, and title length constraint after the editable text, then validates and sanitizes the response against the current vocabulary and metadata definitions. This keeps customization useful without allowing an edited prompt to bypass server-side safety and data validation.

## P3 provider profiles

Provider profiles are managed by administrators through the AI settings screen.
The first adapter is OpenAI-compatible and each profile can define an assistant
endpoint/model, an embedding endpoint/model, and an encrypted API key. The
assistant and embedding tasks select profiles independently. Existing single-
provider settings remain a compatibility fallback until a profile is selected.

## P3 file-aware PDF analysis

File-aware PDF analysis is a manual, user-confirmed workflow. The client first
shows the document preview and prompt field only after the normal owner-scoped
document access check succeeds. The original PDF is uploaded to the selected
provider and supplied to the model as an input file; extracted text is not a
substitute for this workflow. The user must explicitly start the analysis, and
the response remains a suggestion until the user saves any resulting metadata
or notes.

Provider uploads must use the provider's automatic expiration controls. The
initial default should be short-lived, for example one hour after creation,
and the expiration duration should be configurable through application
settings. The API should still attempt explicit cleanup when supported, but
expiration remains the safety net if the request fails or the process stops.
