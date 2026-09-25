# Shared API infrastructure

## Decision

The API has a shared module for cross-cutting infrastructure that is used across features:

```text
packages/api/src/shared/
├── guards/
├── decorators/
├── service/
└── shared.service.module.ts
```

The current shared module provides:

- Winston/Nest logging services
- Rotating log transports
- API throttling through a global guard
- Environment-configured CORS
- Centralized NestJS configuration keys and typed `ConfigService` access
- Role and scope decorators/guards
- Shared constants and helpers

## Dependency boundary

Shared infrastructure may be imported by the application shell and feature modules:

```text
AppModule
  → SharedModule

FeatureModule / FeatureServiceModule
  → SharedModule or narrowly scoped shared providers
```

The shared module must not import business feature modules, feature stores, or feature services. This keeps cross-cutting concerns below the feature graph and prevents shared infrastructure from becoming a circular-dependency hub.

Shared code must not contain document-specific, authentication-workflow-specific, or configuration-business logic. Those belong to their respective features.

## Configuration access

API bootstrap and modules use `@nestjs/config` rather than reading `process.env` throughout the codebase. Configuration keys are centralized in `ConfigKeys`, for example:

```ts
export const ConfigKeys = {
  CLIENT_PATH: 'CLIENT_PATH'
} as const;
```

Consumers use `ConfigService` with the shared configuration type:

```ts
this.configService.get<string>(ConfigKeys.CLIENT_PATH);
```

This keeps key names discoverable and prevents scattered string literals. Feature-specific settings should be added to the centralized configuration shape and validated at startup.

## Global providers

Global guards such as the throttling guard may be registered with `APP_GUARD` from the shared module. Their scope and bypass rules must be documented and tested.

The current throttling guard applies only to API paths. Because the API uses the `/api/v1` prefix, tests should verify that:

- API routes are throttled.
- Frontend/static routes are not accidentally throttled.
- Health/readiness routes have an intentional policy.
- Login, upload, search, and password-change routes have appropriate limits.
- Proxy configuration does not allow clients to spoof the identity used for rate limiting.

## CORS

The API currently enables CORS during bootstrap using the configured frontend origin and credentials support. This is required for the browser client to use the Express session cookie.

Required rules:

- `ROOT_URI` must be explicitly configured for every non-test environment; the current bootstrap check exits when it is missing.
- The allowed origin must be an exact allowlisted origin, not `*`.
- `credentials: true` must never be combined with a wildcard origin.
- Allowed methods and headers should be explicitly listed as the API grows.
- CORS is not an authentication or authorization mechanism; every API endpoint still enforces its own session and ownership rules.
- Add integration tests for an allowed browser origin, a rejected origin, and credentialed requests.

## Logging integration

The shared logging service is the single API logging entry point. Feature services should inject the shared logger or a small logger abstraction rather than instantiate Winston transports themselves.

Nest bootstrap currently creates the configured logger through `LoggingService.initializeLogging()` and passes it to `NestFactory.create(..., { logger })`. This makes the same Winston configuration available to Nest startup/runtime logging from the beginning of the application lifecycle.

If the logging service later gains injected dependencies, keep bootstrap initialization dependency-safe by using a dedicated logger factory/provider rather than constructing a partially initialized service.

Logging configuration should use the names documented in [Logging](./logging.md), especially `LOG_DIR`, `LOG_LEVEL`, `LOG_FILE_MAX_SIZE`, and `LOG_FILE_MAX_FILES`. Existing compatibility aliases such as `LOGFILE` or `logFile` should either be removed or documented as temporary migration names.

Avoid direct `console.log` calls in shared services except for an intentional pre-logger bootstrap failure. Log paths, timezone, JSON mode, and retention should be configuration-driven rather than hard-coded.

## Guard and decorator rules

- Guards enforce request-level policy; application services still enforce ownership and business authorization.
- Decorators declare metadata but do not perform authorization themselves.
- A missing authenticated user must fail closed for protected routes.
- Role/scope names should be shared constants rather than repeated strings.
- Shared guards must have unit tests for missing identity, missing role/scope, and successful access.

## Testing

The shared module should have focused tests for:

- Throttling behavior and route exclusions
- Role and scope enforcement
- Logger redaction and transport configuration
- Log rotation configuration
- Correlation/request context propagation once introduced
- Global-provider registration in a minimal Nest testing module
