# PDF/A archive derivatives

## Goal

Binder should optionally create a validated archival representation of a
document without replacing the uploaded original. PDF/A is a constrained,
self-contained PDF profile intended to preserve a document's static visual
representation over time.

This is a P3 feature. It improves long-term portability, but it is not a
backup, a legal authenticity guarantee, or a replacement for preserving the
original file.

## Storage model

The original remains immutable and keeps its existing checksum:

```text
documents/<year>/<month>/<document-uuid>.pdf
```

The worker writes the archival representation as a derived artifact:

```text
derived/<document-uuid>/archive.pdf
```

The existing OCR artifact and extracted text remain independently
regenerable. Database metadata should expose the archive state and key, but
the database remains the source of truth for Binder metadata such as issuer,
tags, folders, and custom fields.

## Processing path

```text
original upload
  → working copy
    → OCRmyPDF/Tesseract when required
      → PDF/A-2b conversion
        → conformance validation
          → archive.pdf + extracted text + page records
```

The initial target is PDF/A-2b. The conformance level should be a controlled
runtime setting rather than an arbitrary user-provided command-line value.
The worker image must pin the OCRmyPDF, Ghostscript, font, color-profile, and
validation tool versions used for conversion.

## Failure policy

An archive conversion failure must not reject or delete the original upload.
The worker should:

- keep the original available;
- record a failed archive status and a safe error summary;
- leave extraction/search processing retryable where possible;
- expose the failure in the document processing status;
- allow an administrator or owner to requeue the archive step.

Documents with problematic fonts, malformed PDF structures, active content,
or unsupported features may not convert cleanly. The system must not silently
claim PDF/A conformance without validation.

## User-facing behavior

The document viewer should clearly distinguish:

- Original — the exact uploaded file;
- Archive — the validated PDF/A derivative, when available;
- Extracted text — the searchable text representation.

Downloads should not silently substitute the archive for the original. The
user should choose which representation to download when both exist.

## Security and preservation notes

PDF/A does not replace filesystem permissions, encrypted storage, backups, or
checksum auditing. PDF/A also disallows encryption and may remove or alter
active content during conversion. Digitally signed originals must therefore
remain preserved and must not be overwritten by conversion.
