# Security baseline

## Principle

Security is part of the normal development loop. Every feature that adds an endpoint, input, file operation, database query, client flow, dependency, or deployment change must include the relevant security checks.

Automated audits reduce risk but cannot prove that the application is secure. Authorization and data-isolation tests remain mandatory.

## Continuous checks

The repository runs the baseline checks in `.github/workflows/security.yml`; the broader checks below remain the target as the test suite grows.

### Dependencies

- Lock dependency versions.
- Run package-manager audit checks for API, client, and workspace dependencies.
- Review transitive vulnerabilities before upgrading or accepting exceptions.
- Keep Angular, NestJS, TypeScript, Zod, Sequelize, and `basic-crud` versions aligned and patched.

### Static analysis

- TypeScript strict compilation for every package.
- ESLint with security-oriented rules.
- SAST scanning for injection, unsafe deserialization, path traversal, SSRF, and accidental secret use.
- Secret scanning on commits and CI artifacts.
- Detect unsafe use of `any`, dynamic HTML, bypassed sanitization, and unchecked URL/file input where practical.

### API security tests

- Authentication tests for every protected endpoint.
- Ownership and authorization tests for read, update, delete, search, and download operations.
- Tests proving one user cannot access another user's documents, metadata, snippets, embeddings, or files.
- Input boundary tests using invalid and malicious Zod inputs.
- Rate-limit and request-size tests for upload and search endpoints.
- Tests for path traversal, MIME spoofing, oversized files, malformed PDFs, and duplicate uploads.
- Contract tests validating API responses against shared Zod schemas.

### Client security checks

- Angular strict template/type checking.
- No trust in client-side authorization or hidden UI controls.
- Avoid unsafe HTML and only use deliberate, reviewed sanitization boundaries.
- Validate API responses with shared Zod schemas at the API adapter boundary.
- Test that expired sessions and unauthorized responses clear or protect sensitive state.
- Keep document previews/downloads behind authenticated API access.
- Serve the Angular client from an explicitly configured `CLIENT_PATH`; never expose the document storage root as a static directory.

### Runtime and container checks

- Scan the Docker image for OS and package vulnerabilities.
- Run the container as a non-root user where possible.
- Use a read-only filesystem for services that do not need writes.
- Mount document storage explicitly with the narrowest required permissions.
- Do not place secrets in images, source, Dockerfiles, or committed environment files.
- Generate an SBOM when the CI platform supports it.

## Secure defaults

- Local authentication is the primary source of internal users; OIDC is an optional login method mapped to those users.
- Use server-side Express sessions with secure cookie settings; do not use browser local storage for session credentials.
- Any localhost-only JWT mode must be explicitly development-only and loopback-restricted.
- Use an explicit CORS origin allowlist; never use `*` with credentialed session requests.
- Protect every cookie-authenticated state-changing request with the session CSRF token. Login and first-run setup must additionally validate the configured browser origin.
- Server-side authorization is required even when the first deployment has one user.
- Owner scope must be applied before returning database rows, search results, snippets, embeddings, or files.
- SQL must remain parameterized through Sequelize or a reviewed abstraction.
- Query fields, sort fields, and operators exposed by HTTP must be whitelisted.
- File paths are generated from internal document IDs, never from user filenames.
- Uploaded files are treated as untrusted input and stored outside the application source tree.
- Raw files must pass the configured malware-scanning policy before document processing begins.
- New and requeued files remain unavailable for download, preview, extraction, export, and AI analysis until the mandatory malware scan succeeds; scanner errors end in quarantine after retry exhaustion.
- LLM prompts must not include unrelated documents or secrets.
- External LLM use must be explicit, configurable, and documented for privacy impact.
- Logs must not contain document contents, access tokens, secrets, or unnecessary personal data.
- Bootstrap credentials are one-time secrets: log them only during initial account creation, never on subsequent startup or request paths.

## Security gates by milestone

### Before the first endpoint

- Define authentication boundary and ownership model.
- Define the API error shape without leaking stack traces or internal identifiers.
- Enable strict TypeScript and linting.
- Decide the supported dependency and container scanning tools.

### Before upload is enabled

- Enforce maximum request and file sizes.
- Validate MIME type and file signature.
- Prevent path traversal and unsafe filenames.
- Add tests for malformed and hostile files.
- Ensure failed processing cannot expose temporary files.

### Before search is enabled

- Test owner filtering across full-text, vector, and hybrid search.
- Ensure snippets are generated only from authorized documents.
- Define query limits and rate limits.
- Add tests for search-parser and filter-injection edge cases.

### Before deployment

- Run dependency, SAST, secret, container, and contract checks.
- Run authorization regression tests.
- Review environment variables and filesystem permissions.
- Produce a backup and restore test for PostgreSQL and original files.

## Audit cadence

- Every pull request: type checks, lint, unit tests, contract tests, secret scan, and dependency audit.
- Main branch: the committed security workflow runs builds, type checks, API security tests, and a production dependency audit. Full SAST, container scanning, and integration/security tests remain to be added.
- Scheduled: dependency refresh, vulnerability rescan, and review of accepted exceptions.
- Before releases: manual threat-model review for changed flows and a restore test.

## Open security decisions

These must be decided before implementation reaches production:

- OIDC provider and required claims.
- Local credential policy and password-hashing algorithm.
- Persistent Express session store.
- Session-store migration and cleanup policy.
- Initial administrator username and secure bootstrap-secret delivery.
- Reverse proxy/TLS termination model.
- Rate limiting and abuse protection.
- ClamAV deployment, definition-update monitoring, and scanning of restored legacy files.
- Data retention and deletion guarantees.
- Whether documents may be sent to external LLM providers.
