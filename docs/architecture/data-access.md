# Data access layer

## Decision

Use `/basic-crud` as the reusable CRUD store layer between Sequelize models and NestJS application services, subject to the boundaries in this document.

The dependency direction is:

```text
NestJS controllers
  → application services/use cases
    → domain-specific stores and services
      → basic-crud stores
        → Sequelize models
          → PostgreSQL
```

PostgreSQL is configured through a shared `DatabaseModule` using `@nestjs/sequelize` and the typed `ConfigService`. Feature store modules register their models with `SequelizeModule.forFeature(...)` when they are introduced.

The initial connection rules are:

- Connection URL comes from `DATABASE_URL`.
- `synchronize` is disabled; schema changes will use explicit migrations.
- Models are auto-loaded once feature stores are added.
- Connection retries and a bounded pool are configured centrally.
- SQL logging is opt-in through `DATABASE_LOGGING`.
- Controllers and application services do not receive the raw Sequelize instance.

`DatabaseConnectionService` owns connection status, background reconnect attempts, and asynchronous model registration. Feature store modules may register their models when they are introduced; the database module must not require a central list of all application models.

The connection service must not make application startup depend on model loading. Database-dependent operations should use its connection/status guard and report an unavailable-database error when the connection is not ready.

The database permission diagnostic uses PostgreSQL's `has_database_privilege` and `has_schema_privilege` functions to verify connectivity, schema usage, and schema object creation. SQL-file migrations remain responsible for reporting their own detailed migration errors; the diagnostic is advisory and must not replace migration execution or ownership checks.

Local development can use the repository's `docker-compose.yml` PostgreSQL service via `pnpm db:up`. Production database lifecycle remains external to the application container.

Controllers should not call Sequelize models or `basic-crud` directly.

## Good fit for `basic-crud`

Use it for conventional relational resources:

- Documents and document versions
- Document metadata
- Tags and document types
- User and ownership records
- Pipeline job records and processing events
- Pagination, filtering, sorting, and named relational queries
- Common create/update/delete lifecycle behavior
- Read-through caching for stable metadata reads

The existing cache adapter abstraction is useful because the application can start with memory or file-backed caching and later use Redis without changing store APIs.

## Keep outside `basic-crud`

Do not force these operations through the generic CRUD abstraction:

- Reading, writing, hashing, or deleting document files
- Temporary upload handling
- OCR and text extraction
- Background job orchestration
- Embedding generation
- Full-text search ranking
- Vector similarity search
- Hybrid search result assembly
- LLM calls and structured extraction

These belong to services with domain-specific interfaces such as `DocumentStorage`, `DocumentPipeline`, `SearchService`, and `EmbeddingProvider`.

## Ownership and access control

The first schema should include ownership fields even before multi-user behavior is enabled. At minimum, document-like records should have an `ownerId` or equivalent stable user reference.

Ownership must be enforced in the store/application-service boundary:

- User-scoped reads use a query that includes the current owner.
- Updates and deletes include the owner condition in their `WHERE` clause.
- Search results are filtered by owner before they are returned.
- A controller must never be able to pass an arbitrary owner filter and bypass the authenticated identity.

`BaseCrudStore.hasAccess()` currently defaults to allowing access, so it must not be treated as sufficient authorization. Each document store should implement an explicit owner-scoped query or a protected service method.

For future organizations, keep ownership separate from authorization policy. A later access model may add memberships and permissions without changing the physical file layout.

## Caching rules

Cache only data that is safe to reuse and cheap to invalidate:

- Good candidates: document metadata detail views, document types, tags, and stable user settings.
- Avoid initially: original file contents, OCR output, embeddings, pipeline state transitions, and search result pages.
- Never cache data without including the owner/tenant scope in the cache namespace or key.

Every write that changes a cached model must invalidate the relevant store namespace. Pipeline updates that affect a document's searchability or visible status must also invalidate the document metadata cache.

Search-result caching should be considered only after search behavior and invalidation semantics are stable. Search queries can become stale when extracted text, embeddings, ownership, tags, or metadata change.

## Integration requirements

Before adopting the package directly, verify:

1. It is installable as a package or workspace dependency rather than copied source.
2. Its logger and utility imports are available in the new NestJS application.
3. Its Sequelize version matches the application.
4. Its cache adapters have tests for the selected backend.
5. Its query-builder input is not exposed directly to HTTP clients without a whitelist of fields and operators.
6. Its transactions can be passed through pipeline and document-version operations where atomicity matters.

The first application integration should use a small adapter module and a few concrete stores. Avoid making every model inherit from `BaseCrudStore` before the first vertical slice proves the fit.

## Initial concrete stores

The first slice likely needs:

- `DocumentStore`
- `DocumentFileStore`
- `PipelineJobStore`

`DocumentStore` owns relational document queries. `DocumentFileStore` stores file references and hashes, but file bytes remain the responsibility of `DocumentStorageService`. `PipelineJobStore` tracks jobs; it does not execute them.
