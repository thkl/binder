# OCR architecture

## Decision

Use OCRmyPDF with Tesseract for scanned PDFs and image-based documents. Run OCR in a dedicated worker process/container rather than in the NestJS HTTP process.

OCRmyPDF is a good fit because it can create a searchable text layer while preserving a PDF-oriented workflow. Tesseract is the OCR engine underneath it. The worker should share only the required document/derived storage volumes and communicate job state through PostgreSQL-backed pipeline records.

## Processing path

```text
raw file passes malware scan
  → pipeline job created
    → worker detects whether text extraction is needed
      → direct text extraction for text PDFs
      → OCRmyPDF/Tesseract for scanned PDFs and images
        → extracted text and optional searchable PDF in derived storage
          → chunking and indexing
```

OCR should be skipped when a PDF already contains usable text unless the user explicitly requests re-OCR. This avoids unnecessary processing and preserves the original file.

## Container boundary

- The API container handles HTTP, authentication, metadata, and job creation.
- A worker container executes OCR and other CPU/memory-heavy processing.
- The worker image contains the pinned OCRmyPDF and Tesseract versions.
- The worker runs with the least filesystem permissions possible and as a non-root user where supported.
- The worker receives resource limits and per-document timeouts.
- The original raw file is never overwritten by OCR.
- OCR output is written as a derived artifact and can be regenerated.

Do not use OCRmyPDF's example web-service wrapper as the production API. The pipeline should control execution, authentication, resource limits, retries, and cleanup itself.

## Languages

The initial worker image should include German and English language data. Additional language packs should be configurable and added through a pinned worker-image build.

## Failure handling

Record the OCR command/tool version, language configuration, duration, and safe error summary in the pipeline event log. Do not log document contents or sensitive OCR output.

OCR failure must leave the original document available and must not prevent later manual retry or alternative text extraction.

## Licensing and updates

Before packaging the worker, review OCRmyPDF, Tesseract, Ghostscript, and language-data licenses for the intended distribution model. Pin the worker image and update it through the normal dependency/security-audit process.

## First implementation scope

Start with:

- Text extraction from text-based PDFs.
- OCRmyPDF/Tesseract for scanned PDFs.
- German and English language data.
- One retry policy with visible failure status.
- Derived `ocr.pdf` and `extracted.txt` artifacts.

The worker now invokes the `ocrmypdf` executable for queued OCR jobs. It uses German and English (`deu+eng`) by default, configurable through the `pipeline.ocrLanguages` database setting. OCR output is written to `derived/<document-uuid>/ocr.pdf`; MuPDF then extracts the searchable text into `derived/<document-uuid>/extracted.txt`. During extraction, the worker repairs conservative OCR spacing artefacts such as `0 1 . 0 1 . 2 0 2 2` to improve search, issuer matching, AI analysis, and embeddings. The original PDF is never replaced.

The production worker image installs OCRmyPDF, Ghostscript, Tesseract, and the German/English language data. Local worker runs require the same tools to be installed on the host; if `ocrmypdf` is missing, the job fails visibly and follows the normal retry policy.

Image-only input formats can be converted to PDF as part of a later pipeline step if the first vertical slice supports PDF uploads only.
