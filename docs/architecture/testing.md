# API and worker test strategy

The API and worker run their TypeScript specs with Vitest:

```sh
pnpm --filter @binder/api test
pnpm --filter @binder/worker test
```

Coverage reports are available with the corresponding `coverage` scripts. The
current suites are unit and regression tests. They do not replace database,
container, malware-scanner, or deployment integration tests.

## PDF processing baseline

The API tests exercise upload validation and ownership, malware-scan queueing,
duplicate cleanup, safe storage paths, immutable source storage, PDF validation,
thumbnail creation, split, rotation, and composition. The worker tests exercise
page-aware text extraction, OCR-needed decisions, spacing normalization,
derived text writes, storage path checks, OCR argument selection, OCR output
installation and temporary-file cleanup, malware scanner configuration,
issuer matching, and every current claimed-job kind in the worker dispatcher.
Dispatcher cases cover the malware-scan gate, OCR handoff, optional embedding
and PDF/A follow-up jobs, quarantine, retry scheduling, and retry exhaustion.

The PDF fixtures are generated in the tests. They include searchable page text
and do not depend on checked-in personal documents.

## Format adapter regression requirements

When adding format adapters, extend these suites to verify that:

- the API advertises accepted formats and capabilities from the same registry
  used by its upload validation;
- upload selection metadata is treated as a hint; server-side byte inspection
  and the selected parser validate the actual content;
- unknown, malformed, oversized, and mismatched files are rejected before
  document records or processing jobs are created;
- malware scanning gates every parser, preview, OCR, export, and AI operation;
- the original upload remains unchanged while each adapter produces only the
  derived artifacts it supports;
- unsupported operations are unavailable for that format, while supported
  operations preserve their existing behavior;
- extraction results support formats with no stable page numbering;
- failures and retries clean up temporary artifacts and leave originals
  accessible only when the malware state permits it.

Do not use PDF as a fallback for unknown formats. PDF is the reference adapter
and keeps its existing capabilities; each other adapter declares the subset it
implements.
