# Backend feature modules

## Decision

Organize the NestJS API by business feature rather than by technical layer. Each feature owns three module boundaries:

```text
feature/<name>/
├── <name>.store.module.ts
├── <name>.service.module.ts
└── <name>.module.ts
```

The three modules have deliberately different responsibilities:

- `FeatureStoreModule`: Sequelize models, `basic-crud` stores, and persistence adapters.
- `FeatureServiceModule`: application services/use cases and dependencies on store modules.
- `FeatureModule`: controllers, API DTO/schema adapters, and feature-facing providers.

## Dependency direction

The allowed direction is:

```text
FeatureModule (controllers)
  → FeatureServiceModule (use cases)
    → FeatureStoreModule (persistence)
      → Sequelize/PostgreSQL
```

Cross-cutting infrastructure is a separate lower-level dependency:

```text
FeatureModule / FeatureServiceModule
  → SharedModule
```

`SharedModule` may provide logging, throttling, guards, decorators, and infrastructure helpers. It must not import feature modules, stores, or services.

A service from one feature may import another feature's store module:

```text
DocumentServiceModule
  → ConfigurationStoreModule
  → AuthenticationStoreModule
```

This allows feature services to read the data they need without importing another feature's controller/module tree.

## Rules

### Store modules

- Define and export stores needed by application services.
- May import shared database infrastructure.
- May import other store modules only when a persistence concern genuinely requires it.
- Must not import service modules or controller feature modules.
- Must not contain HTTP or authentication workflow logic.

### Service modules

- Define application services and use cases.
- Import their own store module and the store modules of required features.
- Export services needed by the feature's controller module.
- Own business orchestration, authorization checks, transactions, and pipeline commands.
- Must not import another feature's top-level `FeatureModule`.

### Feature modules

- Define controllers and HTTP-facing providers.
- Import only their own service module and explicitly shared infrastructure.
- Must not be imported by another feature.
- Must not access Sequelize models or stores directly from controllers.

## Example feature layout

```text
packages/api/src/features/
├── authentication/
│   ├── authentication.store.module.ts
│   ├── authentication.service.module.ts
│   ├── authentication.module.ts
│   ├── authentication.controller.ts
│   └── services/
├── configuration/
│   ├── configuration.store.module.ts
│   ├── configuration.service.module.ts
│   ├── configuration.module.ts
│   └── stores/
└── document/
    ├── document.store.module.ts
    ├── document.service.module.ts
    ├── document.module.ts
    ├── document.controller.ts
    ├── stores/
    └── services/
```

Initial features:

- `authentication`: local users, sessions, OIDC identity mappings, password changes
- `configuration`: application settings, import owner, storage and processing settings
- `document`: document metadata, ownership, file references, upload, listing, and detail operations
- `pipeline`: processing jobs and events
- `search`: full-text/vector/hybrid search orchestration

The first authentication implementation follows this module split:

```text
AuthenticationModule
  → AuthenticationServiceModule
    → AuthenticationStoreModule
      → DatabaseModule / User model
```

## Cross-feature example

When a document upload needs the configured import owner:

```text
DocumentController
  → DocumentService
    → DocumentStore
    → ConfigurationStore
```

The document feature does not import `ConfigurationModule`. It imports the configuration store module through `DocumentServiceModule`.

When a document request needs the current user:

```text
Authentication middleware/guard
  → authenticated internal user on request
  → DocumentService
    → DocumentStore scoped to ownerId
```

Document services should receive an authenticated user context as an input. They should not import authentication controllers or invoke login flows.

## Avoiding circular dependencies

- Do not use `forwardRef()` as the normal solution. It is an escape hatch for a dependency graph that should be redesigned.
- Do not import top-level feature modules across features.
- Do not have stores call services.
- Do not have two application services call each other synchronously as their primary design.
- Keep shared infrastructure below the feature graph; feature modules must never be imported by `SharedModule`.
- Move shared behavior into a lower-level application service or domain utility when two features genuinely need it.
- Keep event publishing one-way for cross-feature side effects where possible.
- Make ownership and configuration dependencies explicit in service constructors.

## NestJS module convention

Each feature module should make its public surface obvious:

```ts
@Module({
  imports: [DocumentServiceModule],
  controllers: [DocumentController]
})
export class DocumentModule {}
```

The service module exports only application services:

```ts
@Module({
  imports: [DocumentStoreModule, ConfigurationStoreModule],
  providers: [DocumentService],
  exports: [DocumentService]
})
export class DocumentServiceModule {}
```

The store module exports only stores:

```ts
@Module({
  providers: [DocumentStore],
  exports: [DocumentStore]
})
export class DocumentStoreModule {}
```

The exact decorators and Sequelize model registration will be added when the first feature is implemented.

## Testing implications

- Store tests exercise database query behavior and ownership predicates.
- Service tests mock store modules and test use-case rules without booting the whole Nest application.
- Controller tests validate HTTP/Zod boundaries and delegation.
- An architecture test should reject imports from a feature's service/store layer into another feature's top-level module.
