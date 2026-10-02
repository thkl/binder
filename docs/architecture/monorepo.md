# Monorepo and API contracts

## Decision

The project is a TypeScript monorepo. The first package layout is:

```text
packages/
├── api/
├── client/
└── common/
```

The shared package uses Zod schemas as the source of truth for API inputs and outputs. TypeScript types are inferred from those schemas rather than maintained separately.

## Package responsibilities

### `packages/api`

NestJS 12 application and server-side concerns, written in TypeScript 6:

- HTTP controllers and API modules
- Authentication and OIDC integration
- Application services and use cases
- Sequelize models and migrations
- `basic-crud` stores
- Filesystem storage
- Document processing and background jobs
- Search and embedding providers
- API error handling

The API is organized by business feature. Each feature uses separate store, service, and controller module boundaries as defined in [Backend feature modules](./backend-modules.md).

The API may import `common`. It must not expose Sequelize models or internal service types through the public API contract.

### `packages/client`

Angular 22 application and browser concerns:

- Pages and components
- Client-side state and routing
- API client services
- Upload and document preview UX
- Search result presentation

The client uses modern Angular patterns by default:

- `@if` and `@for` for template control flow
- Signals for component and feature state
- Signal stores for shared feature state
- Signal Forms for form state and validation
- Standalone components and provider configuration

The client may reuse the existing `ng_store` patterns and the `agrid` component library, subject to the integration rules in [Client assets](./client-assets.md).

Avoid introducing older observable-heavy state patterns for new features unless an external API or a streaming workflow makes them the clearer choice. RxJS remains available where it is appropriate for asynchronous streams, HTTP integration, and event pipelines.

The client may import `common`. It must not import NestJS, Sequelize, Node filesystem modules, or server-only dependencies.

### `packages/common`

Framework-independent contracts and primitives:

- Zod request schemas
- Zod response schemas
- Inferred input/output TypeScript types
- Shared enums and literal values
- Pagination and error-envelope contracts
- Document status and document-type contracts

`common` must remain safe to use in both a browser bundle and a Node.js process. It must not depend on Angular, NestJS, Sequelize, database drivers, filesystem APIs, or environment-specific configuration.

## Version baseline

The initial workspace targets:

| Area | Baseline |
| --- | --- |
| Client | Angular 22 |
| API framework | NestJS 12 |
| Language | TypeScript 6 |
| Shared validation | Zod |

The workspace should pin compatible versions and use one TypeScript configuration strategy so the API, client, and common package do not drift apart.

## Zod contract pattern

Each externally visible API shape should have one schema in `common`:

```ts
export const DocumentSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  mimeType: z.string(),
  status: DocumentStatusSchema,
  ownerId: z.string(),
  createdAt: z.string().datetime(),
});

export type Document = z.infer<typeof DocumentSchema>;
```

For an endpoint, define both sides explicitly:

```text
CreateDocumentInput
DocumentResponse
ApiError
PaginatedResponse<T>
```

The API validates incoming requests and validates response DTOs at the boundary. The client validates decoded responses in its API adapter, especially during development and tests. This catches contract drift even when both packages are built from the same repository.

## Contract rules

- Do not duplicate request and response interfaces in API and client packages.
- Do not share Sequelize model classes with the client.
- Do not expose database column names unless they are intentionally part of the public API.
- Use stable API field names and map database-specific names in the API layer.
- Use ISO 8601 strings for dates at the JSON boundary.
- Use explicit nullable fields rather than ambiguous missing values.
- Keep upload endpoints separate from JSON document metadata endpoints.
- Version the API when a breaking contract change is unavoidable.
- Add contract tests for every public endpoint.

## Validation layers

Zod is the API contract validator, not the only validation layer:

1. Client validates user input for immediate feedback.
2. API validates HTTP input using the shared schema.
3. Application services enforce business rules.
4. Sequelize/PostgreSQL enforce persistence constraints.

The client must never be trusted for authorization, ownership, file type, or size checks.

## API response conventions

The initial API should use consistent envelopes:

```text
Successful single resource: { data: T }
Successful collection:       { data: T[], meta: PaginationMeta }
Validation/application error: { error: ApiError }
```

The exact envelope should be defined as Zod schemas in `common` before the first controller is implemented.

## Build and dependency direction

The workspace uses pnpm workspaces. Root-level scripts should support installing, building, linting, testing, and auditing all packages while still allowing package-level commands.

The dependency graph should remain acyclic:

```text
common
  ↑       ↑
api     client
```

`common` contains no imports from `api` or `client`. Shared utilities that require server or browser APIs belong in the respective package, not in `common`.

The workspace should provide one command to build and test all packages, while allowing package-level tests to run independently.

### Test and coverage commands

Run the complete test suite with:

```bash
pnpm test
```

Coverage is available for every package that currently has tests:

```bash
pnpm coverage
```

The common, API, and worker packages use Node's built-in test runner and
coverage reporting. The Angular client uses Angular's `@angular/build:unit-test`
builder with Vitest and jsdom. Its HTML and LCOV reports are written below
`packages/client/coverage/`; generated coverage artifacts are ignored by Git.

Coverage thresholds are intentionally not enforced yet. The first step is to
establish a baseline and add focused tests for security, ownership, pipeline,
contract, and critical client flows before raising thresholds incrementally.

## First contract slice

Before implementing the upload endpoint, define these shared schemas:

- `DocumentStatusSchema`
- `DocumentSchema`
- `CreateDocumentInputSchema`
- `DocumentListQuerySchema`
- `PaginationMetaSchema`
- `ApiErrorSchema`
- `DocumentProcessingEventSchema`

This gives the first vertical slice a stable contract before NestJS controllers and Angular services are written.
