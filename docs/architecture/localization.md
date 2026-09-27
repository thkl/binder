# Localization

The client has a small signal-based runtime localization service. English (`en`) and German (`de`) are provided initially, with the selected language stored in browser local storage and switchable from the authenticated application header.

The contract is intentionally extensible:

- language codes are validated as `ll` or `ll-RR` values rather than a fixed enum;
- vocabulary items keep their canonical `name` for search, imports, and AI context;
- localized display values are stored in a `translations` JSONB map, with fallback to the canonical name;
- the API and common package can carry additional translations without a schema migration.

Migration V019 adds translations to document types, categories, and tags and seeds German labels for the built-in vocabulary. New personal or workspace vocabulary entries may provide English and German labels; missing languages fall back gracefully.

The client dictionary currently contains the application UI in English and German. Adding another language requires adding its dictionary and exposing a language choice; the vocabulary storage and shared Zod contract do not need to change.
