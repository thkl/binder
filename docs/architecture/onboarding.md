# First-run onboarding

## Goal

Binder should provide a guided first-run assistant so a new installation can
create its administrator and become usable without reading a generated
password from the application log. This is a P3 user-experience feature; it
does not weaken the existing server-side authentication and ownership rules.

The assistant should be deterministic and form-driven. It is not an LLM chat
agent and must not make security or infrastructure decisions autonomously.

The first implementation slice creates the administrator account and starts a
normal Express session. It is exposed through `/api/v1/setup/status` and
`/api/v1/setup/admin`; the remaining storage, processing, AI, OIDC, backup,
and review steps are subsequent onboarding increments.

## Setup access

When no internal user exists, the API exposes a minimal setup status that tells
the client whether onboarding is required. Creating the first administrator
must require an explicit one-time setup proof, such as a deployment-provided
setup secret or a loopback-only setup mode. The API must never permit an
unauthenticated remote request to create an administrator merely because the
user table is empty.

The setup proof must be:

- accepted only while setup is required;
- rate limited and protected against repeated guesses;
- compared without returning the secret to the client;
- invalidated immediately after administrator creation or setup cancellation;
- excluded from logs, telemetry, error responses, and browser storage.

Binder currently uses the deployment-provided `SETUP_SECRET` as this setup
proof. The onboarding page never persists it and the API compares a digest of
the supplied value rather than logging or returning it.

The setup endpoint must be disabled permanently after the first administrator
transaction succeeds. A database lock or equivalent transaction boundary must
ensure that two browser tabs or two API instances cannot create competing
bootstrap administrators.

## Guided steps

The first version should use a resumable stepper with clear required and
optional steps:

1. **Welcome and setup security** — explain local storage, the setup proof,
   and the remaining steps.
2. **Administrator account** — choose username, password, and confirmation.
   The chosen password is hashed immediately and is never logged. Because the
   user selected it during setup, the account does not need a forced temporary
   password change.
3. **Storage** — validate the absolute document, inbox, derived-file, and
   backup paths and show whether the API/worker can read and write them.
4. **Processing** — check worker reachability, OCR language availability, and
   the configured processing queue.
5. **Optional AI** — configure or skip hosted assistant and embedding
   providers. Explain that document content may leave the server when an
   external provider is enabled.
6. **Optional OIDC** — configure or skip OIDC and validate issuer discovery,
   client configuration, and internal-user mapping behavior.
7. **Backups** — enable the scheduled backup and retention settings and run a
   writable-destination check.
8. **Review and finish** — show the effective non-secret configuration,
   identify skipped optional steps, and complete onboarding.

Every step must have a server-side validation endpoint or transaction-backed
save. Client-side validation is only a usability aid. Optional steps can be
skipped and revisited from Application Settings.

## API shape

The exact route names remain to be finalized, but the contract should include
the following capabilities:

```text
GET  /api/v1/setup/status
POST /api/v1/setup/admin
POST /api/v1/setup/validate-storage
POST /api/v1/setup/validate-processing
POST /api/v1/setup/complete
```

Setup request and response schemas belong in `packages/common` and must be
validated with Zod. Setup responses must not include password material,
setup-proof values, decrypted API keys, session identifiers, or filesystem
secrets.

After successful administrator creation, the API should establish the normal
Express session and return the client to the regular password/session flow.
The setup routes must continue to be guarded server-side even if the client
hides the onboarding screen after completion.

## Runtime settings

The assistant may write database-backed runtime settings, but it must not move
bootstrap environment configuration into the database. Database credentials,
`APP_ROOT_PATH`, `ENCRYPTION_KEY`, client path, and setup access controls remain
deployment configuration. Storage paths and processing schedules can be
validated and saved as runtime settings according to the existing
configuration ownership rules.

Secrets entered during onboarding must be encrypted at rest where required and
must never be printed in Winston logs. Validation errors should identify the
problem and its recovery action without echoing secret values.

## Completion and recovery

Onboarding completion should be recorded separately from the existence of a
user, so an administrator can resume optional configuration if the browser is
closed midway. If setup fails after the admin transaction, the user can log in
and continue the remaining steps from Application Settings. A separate,
explicit administrator-reset procedure remains necessary for lost credentials;
the onboarding route must not become a password-recovery bypass.
