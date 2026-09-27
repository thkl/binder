# Authentication and API conventions

## Authentication decision

The application has internal local users as its source of authorization. OIDC is an optional authentication method that maps an external identity to one of those internal users.

## First-run administrator bootstrap

On startup, the API checks whether any internal user exists. If none exists, it creates one local administrator account:

- Username is configurable, with `admin` as the development default.
- A cryptographically random temporary password is generated.
- Only the password hash is stored in PostgreSQL.
- The temporary password is emitted once through the bootstrap logger so the administrator can complete the first login.
- The account is marked `mustChangePassword = true`.

The bootstrap operation must be idempotent and safe when multiple API instances start at the same time. Use a database transaction and an appropriate lock or uniqueness constraint so that only one administrator is created.

The temporary password must not be regenerated or logged again on every restart. If the bootstrap credential is lost, an explicit administrator-reset procedure is required rather than silently creating another account.

The initial implementation lives in the authentication feature and uses the SQL migrations:

```text
packages/api/migrations/001_create_users.sql
packages/api/migrations/002_create_user_sessions.sql
```

### Local login

- Local users authenticate with an application-managed credential.
- Passwords must be stored with a current password-hashing algorithm; plaintext and reversible encryption are not permitted.
- Successful login creates a server-side Express session.
- A user with `mustChangePassword = true` may only access the password-change, logout, and minimal session/status endpoints until the password is changed.
- A successful password change clears `mustChangePassword` and invalidates the previous session set.
- The client reads the authenticated-session state and routes the user to a dedicated password-change screen before rendering the normal application shell.
- The client must not rely on route guards alone; the API enforces the same restriction on every protected endpoint.
- Session cookies must be `HttpOnly`, `Secure` outside local HTTP development, and use an appropriate `SameSite` policy.
- Production must use a shared persistent session store; the default in-memory Express session store is for development only.

The initial production session store is `connect-pg-simple` using the application's PostgreSQL connection pool. It keeps session state server-side without introducing Redis solely for authentication sessions. The session table is managed as an explicit database migration, not created implicitly at runtime in production.

### OIDC login

- OIDC is optional and configured through environment variables.
- The OIDC issuer and subject form the stable external identity key.
- The external identity maps to an internal user record.
- Email or display name may assist account linking, but must not be the sole stable identity key.
- The internal user owns documents and permissions after login, regardless of whether the login was local or OIDC.
- Account-linking and automatic user creation policy must be explicit before OIDC is enabled in production.

### Local-development JWT

A development-only JWT mode may be provided for local tooling and automated tests.

Required restrictions:

- Disabled by default.
- Enabled only by an explicit development configuration flag.
- Accepted only for loopback requests (`localhost`, `127.0.0.1`, or `::1`) and a local development origin.
- Never enabled in production or exposed through a public container binding.
- Clearly labeled in logs and diagnostics.

The JWT mode must still resolve to an internal user so ownership behavior remains identical to normal sessions.

The first local-auth endpoints are:

```text
POST /api/v1/auth/login
GET  /api/v1/auth/session
GET  /api/v1/auth/users        # administrators; safe user-directory fields only
POST /api/v1/auth/password
POST /api/v1/auth/logout
```

Login regenerates the session to reduce session-fixation risk. Password changes clear the forced-change state. The client still needs to enforce the forced-password-change route, while the API remains authoritative.

## API versioning

All public HTTP endpoints are versioned from the beginning. The initial version is:

```text
/api/v1/...
```

Breaking changes require a new major API version. Additive response fields and new optional request fields should remain backward-compatible when practical.

## Browser access and CORS

The Angular client communicates with the API using credentialed requests so the server-side Express session cookie can be sent. The API therefore uses an explicit configured frontend origin, supplied through `ROOT_URI`, rather than a wildcard CORS policy.

`ROOT_URI` is deployment configuration, not a user-controlled request value. The current bootstrap checks that `ROOT_URI` exists and exits when it is missing, preventing the API from starting with an undefined credentialed-origin policy.

## Serving the client

The NestJS API serves the compiled Angular application through `@nestjs/serve-static`. `CLIENT_PATH` is required at startup and points to the built client directory. The value is read through the typed `ConfigService` using the centralized `ConfigKeys.CLIENT_PATH` key. Static handling excludes the versioned API prefix so API routes remain owned by Nest controllers.

Development example:

```text
CLIENT_PATH=packages/client/dist/client
```

Docker should set `CLIENT_PATH` to the path where the client build is copied in the runtime image. The API should fail clearly when the configured client path does not exist rather than silently serving an empty shell.

## Endpoint conventions

Use resource-oriented endpoints with explicit action endpoints where the operation is not ordinary CRUD:

```text
GET    /api/v1/documents
POST   /api/v1/documents
GET    /api/v1/documents/:id
PATCH  /api/v1/documents/:id
DELETE /api/v1/documents/:id
GET    /api/v1/documents/:id/file
POST   /api/v1/documents/:id/reprocess
GET    /api/v1/documents/:id/pipeline
```

The list endpoint supports pagination and whitelisted filtering/sorting:

```text
GET /api/v1/documents?page=1&pageSize=25&sort=createdAt&direction=desc&status=ready
```

Natural-language search should have a dedicated endpoint because its query and result semantics differ from ordinary CRUD listing:

```text
GET /api/v1/search/documents?q=car%20inspection%20last%20summer&page=1&pageSize=20
```

All list and search endpoints must apply the authenticated owner's scope before returning rows, snippets, files, or derived content.

## Contract rules

- Query parameters are validated by shared Zod schemas.
- Sort fields, filter fields, directions, and page sizes are allow-listed.
- The client cannot submit or override the owner ID for normal document operations.
- File upload uses a dedicated multipart endpoint and returns a document processing response, not a raw database model.
- API responses use the common success/error envelopes defined in `monorepo.md`.
