# Client assets

## Decision

`ng_store` is internal project code and may be changed freely. We should evolve the useful parts directly into the new client architecture rather than preserve compatibility with the project it came from.

The integration still sits behind the new monorepo and Zod contract boundaries so the store remains reusable and does not become tied to one API response format.

Candidate assets:

- `/Users/thomaskluge/Development/ng_store` for signal-based entity state, HTTP-backed loading, and server pagination patterns.
- [`agrid`](https://thkl.github.io/agrid/) for the document grid, server-side filtering/sorting/pagination, and document/folder tree views.

Neither asset should dictate the API contract. The shared Zod schemas in `packages/common` remain authoritative.

## `ng_store` reuse plan

`ng_store` contains useful starting patterns for:

- Signal-based entity state
- Computed filtered views
- Selected entity state
- Loading and error state
- Server-side pagination and sorting
- Reusable table descriptions

It currently also contains application-specific coupling that should be removed or redesigned:

- `src/app/...` imports
- A custom `ApplicationService`
- `ngx-logger`
- Angular Material-specific helpers
- Dynamic response extraction through `responseKey`, `itemsKey`, `rows`, and `count`
- Broad `any` types in request and response handling

The first refactor should be a client-side store foundation that consumes typed API adapters. Each feature store should use concrete types inferred from `packages/common`, for example `Document`, `CreateDocumentInput`, and `PaginatedResponse<Document>`.

The new API response envelope should remove the need for response-key guessing. The adapter should:

1. Make a typed HTTP request.
2. Parse the response with the corresponding Zod schema.
3. Return a typed result or a normalized typed error.
4. Update the signal store state.

The store should own state and orchestration, not HTTP response-shape compatibility logic.

## `agrid` reuse plan

The published `agrid` documentation demonstrates the capabilities needed for the first document UI:

- Typed column definitions
- Server-side filtering
- Server-side pagination and sorting
- Lazy server-loaded tree children
- Signal-based providers and derived visible rows
- Selection and editable-row events

Likely uses in this application:

| Product feature | agrid use |
| --- | --- |
| Document inbox/list | Server-filtered and paginated grid |
| Metadata browsing | Typed columns and controlled cell renderers |
| Folder/category navigation | Tree with lazy-loaded children if needed |
| Bulk actions | Row selection and explicit application-service commands |
| Search results | Server-side query state; result snippets rendered as cells/details |

The grid must remain a presentation and interaction component. It must not construct unrestricted database filters or call the API with arbitrary query parameters. A feature adapter should translate grid query state into the whitelisted Zod query input for the relevant endpoint.

## Integration boundary

Recommended client flow:

```text
agrid events
  → feature adapter
    → common Zod query schema
      → typed API client
        → signal store
          → agrid datasource/provider
```

For writes:

```text
agrid edit/selection event
  → feature command
    → common Zod input schema
      → API client
        → refresh or patch signal-store state
```

Do not let grid components know about URLs, database field names, or authentication details.

## Compatibility gate

Before adding either asset as a workspace dependency, verify:

1. Angular 22 and TypeScript 6 compatibility.
2. Standalone component and signal support.
3. Package licensing and redistribution terms.
4. Build output and peer dependencies.
5. SSR/build compatibility if the client later needs SSR.
6. Keyboard accessibility and screen-reader behavior.
7. Virtualization behavior for large document collections.

For `ng_store`, start by extracting and refactoring the selected modules directly into `packages/client`. A separate internal package can be introduced later if multiple applications need the same store library. For `agrid`, prefer a package dependency or workspace link over copying its source into this repository.

## First client proof of concept

Before building the complete UI, prove one vertical slice:

- A typed `DocumentListQuerySchema` in `common`.
- A typed API adapter that validates the paginated document response.
- A signal store holding the current document page, total count, loading state, and error state.
- An `agrid` document grid driven by that store.
- Server-side sorting and pagination.
- A selected-document action that opens the document detail view.
