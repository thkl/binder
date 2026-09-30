# Logging

## Decision

The API uses Winston for structured application logging. `LoggingService.initializeLogging()` is installed during Nest bootstrap and passed into `NestFactory.create`, so Nest's own logs use the same rotating/console transports. The pipeline worker uses the same rotation settings and writes `worker-YYYY-MM-DD.log` and `worker-error-YYYY-MM-DD.log`. Logging supports console output for Docker and rotating files for deployments that retain local logs.

The frontend should use a small environment-aware logging facade rather than writing directly to `console` throughout feature code. Browser logs must never contain credentials, session identifiers, document contents, or extracted personal data.

## API transports

The initial Winston setup should provide:

- Console transport for Docker and local development.
- Rotating file transport for persistent application logs.
- Configurable log level and log directory.
- JSON output for machine-readable production logs.
- Human-readable output as an optional development format.

Suggested environment configuration:

```text
LOG_LEVEL=info
LOG_DIR=./logs
LOG_FILE_MAX_SIZE=20m
LOG_FILE_MAX_FILES=14d
LOG_CONSOLE=true
LOG_JSON=true
```

Use a rotating-file transport with bounded size and retention. The log directory must be separate from document storage and must have appropriate filesystem permissions.

The administrator-only API exposes available rotated files through `GET /api/v1/logs` and downloads through `GET /api/v1/logs/:filename`. Passing `?view=true` returns a text preview and transparently decompresses `.gz` rotations. Only validated `application-*` and `worker-*` rotated filenames are served. The Docker API and worker containers mount the same log volume so the API can list both services' files.

## Structured fields

Where available, API log entries should include:

- Timestamp
- Log level
- Service/package name
- Request or correlation ID
- HTTP method and route template
- Response status and duration
- Internal user ID, without sensitive identity claims
- Document ID, without document contents
- Pipeline job ID and step
- Error name and safe message

Use route templates such as `/api/v1/documents/:id`, not raw URLs containing query strings or potentially sensitive values.

## Sensitive-data rules

Never log:

- Passwords or password hashes
- Setup secrets or bootstrap passwords
- Session IDs, cookies, access tokens, refresh tokens, or authorization headers
- OIDC client secrets
- Full document contents, OCR text, embeddings, or uploaded binary data
- Unredacted LLM prompts or responses containing document data
- Unnecessary personal data

## Error handling

- Log detailed stack traces on the server where appropriate.
- Return stable, sanitized `ApiError` responses to clients.
- Do not expose stack traces, SQL fragments, filesystem paths, or internal identifiers in production responses.
- Attach the correlation ID to the API error response so an administrator can locate the corresponding server log entry.

## Operational requirements

- Handle file-transport failures without taking down the API.
- Prevent unbounded log growth through rotation and retention.
- Document how logs are backed up, shipped, and deleted.
- Add tests that verify sensitive fields are redacted.
- Add tests that verify setup secrets and password material are never emitted.
