# Webhook workflows

Administrators can configure one metadata condition that sends a document to a
webhook when that field changes and matches the rule. The trigger supports the
built-in issuer, document type, category, and tags fields, plus custom metadata
fields.

Supported operators are `equals`, `does not equal`, `contains`, `is set`, and
`is not set`. Text comparisons ignore case. For example, selecting `issuer`,
`equals`, and `Acme` triggers when a metadata update sets the issuer to Acme.
Unapplied AI suggestions do not trigger a webhook.

## Configuration

Administrators configure the rule under **Settings → Workflows**:

- enable or disable the workflow;
- select a metadata field, operator, and comparison value;
- set the HTTP or HTTPS endpoint;
- optionally set a Bearer token, encrypted at rest;
- edit a JSON request body template and send a test request.

The endpoint must resolve only to public IP addresses. Redirects are not
followed, and webhook requests have a 10-second timeout. The API pins the
connection to the address it validated to reduce DNS-rebinding risk.

## Template variables

The template is parsed as JSON, and placeholders are replaced in string values
before the request is serialized. A placeholder used by itself keeps the
original JSON value type. Available values include:

- `{{document.uuid}}`, `{{document.title}}`,
  `{{document.originalFilename}}`, `{{document.mimeType}}`,
  `{{document.createdAt}}`, and `{{document.updatedAt}}`;
- `{{metadata.issuer}}`, `{{metadata.issuerName}}`,
  `{{metadata.documentType}}`, `{{metadata.category}}`, and
  `{{metadata.tags}}`;
- custom fields under `{{metadata.custom.fieldKey}}`;
- `{{condition.field}}`, `{{condition.operator}}`,
  `{{condition.expected}}`, and `{{condition.actual}}`.

## Delivery and retries

Document audit events enqueue a durable delivery record with a rendered payload.
The API dispatches pending records in the background. Failed requests retry with
an increasing delay, up to eight attempts. Administrators can inspect recent
attempts and manually retry exhausted deliveries from the workflow settings
page. The queue stores the metadata payload needed for retries; it does not
store the webhook Bearer token.

Each audit event is queued at most once. A later metadata update that also
matches creates a new delivery. Removing or changing a value so it no longer
matches does not send a webhook.
