# Extensions and plugins

## Direction

Plugins are a P3 platform feature. The first goal is a stable extension
boundary, not an unrestricted mechanism for loading arbitrary Node.js code
inside the API process.

Initial extension points should include:

- document imported;
- document processing completed;
- metadata manually saved;
- scheduled maintenance tick;
- explicit user action such as “run plugin”.

Each plugin should declare a manifest with an API version, capabilities,
configuration schema, event subscriptions, and optional UI contributions.
Credentials and plugin settings belong in encrypted application settings.

## Safety boundary

Plugins must receive a scoped document context and typed service interfaces.
They must not access Sequelize models, arbitrary SQL, filesystem paths, raw
session data, or other users' documents directly. A plugin that needs file
content must request a controlled, ownership-checked read through the plugin
host.

The preferred deployment model is a separate worker or container process for
third-party plugins. In-process plugins may be reserved for built-in,
reviewed extensions. Every plugin action needs a timeout, retry policy,
structured logging, and a way to disable it without uninstalling the app.

## First candidates

### Calendar plugin

The first built-in implementation inspects a configured custom due-date field
and creates an owner-scoped iCalendar event. It is idempotent: one document has
one event record, which is updated when the due date or title changes. The
current implementation provides an authenticated `.ics` download rather than
connecting directly to a calendar provider. External provider credentials,
two-way synchronization, and calendar subscriptions remain future work.

### Email import plugin

Email ingestion should be an adapter that receives messages from a configured
mailbox, extracts attachments, and hands them to the existing inbox/import
pipeline. The plugin should preserve sender, subject, message ID, and received
time as provenance metadata and use message IDs plus content checksums for
deduplication.

## UI and lifecycle

Administrators should be able to see installed plugins, enabled state,
version, last execution, failures, and requested capabilities. A plugin must
not silently add navigation or settings without declaring its UI contribution.
The extension API and event payloads must be versioned independently from the
internal database schema.
