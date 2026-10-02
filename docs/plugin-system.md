# Binder plugin foundation

Binder plugins are packaged TypeScript modules that are registered when the API
starts. The first plugin slice provides a stable manifest, an owner-scoped
document lifecycle event contract, and an administrator endpoint for inspecting
registered plugins.

## Security boundary

Plugins are application code. Binder does not load JavaScript, npm packages, or
module paths from PostgreSQL or from user input. A plugin must be installed as
part of the application image and registered by a NestJS module at startup.
This keeps plugin code inside the normal dependency, container, and security
auditing process.

## Plugin manifest

Every plugin provides a manifest with:

- a stable kebab-case `id`;
- a semantic `version`;
- a user-facing name and description;
- one or more capabilities;
- an explicit `enabled` flag.

The shared Zod contracts live in `packages/common/src/index.ts`. The API
registry validates every manifest before it is stored.

Supported capability identifiers are:

- `document-events` for reacting to document lifecycle events;
- `document-import` for future external document sources;
- `document-analysis` for future document analysis providers;
- `calendar` for future due-date/calendar integrations.

## Registering a plugin

A plugin module can inject `PluginRegistryService` and register its implementation
from `onModuleInit`:

```ts
registry.register({
  manifest: {
    id: 'calendar',
    name: 'Calendar integration',
    version: '0.1.0',
    description: 'Creates calendar entries from approved document metadata.',
    capabilities: ['document-events', 'calendar'],
    enabled: false,
  },
  async onDocumentEvent(event) {
    // React only to approved metadata events and keep ownerUuid as the tenant key.
  },
});
```

The registry isolates plugin failures. A failing plugin is logged and does not
fail the document upload, metadata update, or audit transaction.

## Events

API audit events recorded through `DocumentAuditService` are forwarded as
`document.<event-type>` events. The payload contains only the safe audit summary
and filtered details; it does not include document text, filesystem paths, or
document contents. The event also contains the document owner and actor UUID so
a future integration can keep all work owner-scoped.

Administrators can inspect registered plugins with:

```text
GET /api/v1/plugins
```

The endpoint is protected by the normal session authentication, web scope, and
administrator role checks.
