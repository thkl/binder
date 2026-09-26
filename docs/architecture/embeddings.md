# Hosted embeddings

Embeddings are an optional second stage of the document pipeline. OCR and text extraction remain local. When `embeddings.enabled` is enabled, the worker chunks the extracted page text and sends the chunks to the configured OpenAI-compatible embeddings endpoint.

The default is disabled. This is intentional: enabling it sends document text, which may contain personal or confidential information, to a third-party service. The API key is stored encrypted in the `settings` table and is decrypted only by the worker at startup.

The worker currently stores vectors as JSONB in `document_embeddings`. This keeps the first hosted-provider implementation independent of a PostgreSQL extension. The rows contain the document, page, chunk, provider, model, dimensions, content, and vector. Semantic retrieval and an optional pgvector index are a later search milestone.

Settings:

- `embeddings.enabled`
- `embeddings.provider` (`openai-compatible`)
- `embeddings.endpoint`
- `embeddings.model`
- `embeddings.apiKey`
- `embeddings.chunkSize`
- `embeddings.chunkOverlap`

The worker is split into focused modules: `config.ts`, `database.ts`, `storage.ts`, `extraction.ts`, `ocr.ts`, `embeddings.ts`, and `pipeline-worker.ts`. `main.ts` only bootstraps configuration, starts the worker, and handles shutdown.
