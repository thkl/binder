# Hosted embeddings

Embeddings are an optional second stage of the document pipeline. OCR and text extraction remain local. When `embeddings.enabled` is enabled, the worker chunks the extracted page text and sends the chunks to the configured OpenAI-compatible embeddings endpoint.

The default is disabled. This is intentional: enabling it sends document text, which may contain personal or confidential information, to a third-party service. The selected provider profile and API key are loaded by the worker at startup; the profile API key is stored encrypted with `ENCRYPTION_KEY`.

The worker stores the original vectors as JSONB and also writes a native pgvector column. Semantic retrieval uses PostgreSQL cosine-distance ordering, with an HNSW index for the default 1536-dimensional model. Other dimensions remain queryable but do not use that index until a matching expression index is added.

The database image must provide the `vector` extension. The bundled Docker Compose configuration uses `pgvector/pgvector:pg17`. For an externally managed PostgreSQL server, install pgvector before applying migration 15.

Settings:

- `embeddings.enabled`
- `embeddings.chunkSize`
- `embeddings.chunkOverlap`
- `ai.embeddingProviderUuid`

Provider endpoint, model, adapter, and credentials are configured in the
administrator AI provider profile list. Legacy embedding settings remain as a
fallback for installations that have not selected a profile yet.

The worker is split into focused modules: `config.ts`, `database.ts`, `storage.ts`, `extraction.ts`, `ocr.ts`, `embeddings.ts`, and `pipeline-worker.ts`. `main.ts` only bootstraps configuration, starts the worker, and handles shutdown.
