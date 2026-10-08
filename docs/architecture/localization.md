# Localization

The client has a small signal-based runtime localization service. English (`en`) and German (`de`) are provided initially, with the selected language stored in browser local storage and switchable from the authenticated application header.

The contract is intentionally extensible:

- language codes are validated as `ll` or `ll-RR` values rather than a fixed enum;
- vocabulary items keep their canonical `name` for search, imports, and AI context;
- localized display values are stored in a `translations` JSONB map, with fallback to the canonical name;
- the API and common package can carry additional translations without a schema migration.

Migration V019 adds translations to document types, categories, and tags and seeds German labels for the built-in vocabulary. New personal or workspace vocabulary entries may provide English and German labels; missing languages fall back gracefully.

The application UI is maintained as one JSON catalog per language under `packages/api/src/features/localization/catalogs/`. The API exposes `GET /api/v1/localization/languages` for the language registry and `GET /api/v1/localization/catalog/:language` for the selected catalog. The client loads the catalog at startup and on language changes; the server catalogs are the single source of truth. Adding a language now means adding a validated catalog and rebuilding the API, not changing the client language-switcher code.
