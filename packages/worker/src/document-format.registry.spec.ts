import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_FORMAT_CATALOG } from '@binder/common';
import {
  detectAndValidateWorkerFormat,
  getWorkerDocumentFormatAdapter,
  WORKER_DOCUMENT_FORMAT_IDS,
  WORKER_DOCUMENT_FORMATS,
} from './document-format.registry.js';
import { createPdfFixture } from './pdf-test-fixture.js';

describe('worker document format registry', () => {
  it('registers the same initial format descriptors as the shared catalog', () => {
    expect(WORKER_DOCUMENT_FORMATS).toEqual(DOCUMENT_FORMAT_CATALOG);
    expect(WORKER_DOCUMENT_FORMAT_IDS).toEqual(['pdf']);
  });

  it('detects and validates PDF import bytes with the registered adapter', async () => {
    await expect(detectAndValidateWorkerFormat(createPdfFixture(['worker fixture']))).resolves.toEqual(
      DOCUMENT_FORMAT_CATALOG[0],
    );
  });

  it('rejects non-PDF content and MIME types without invoking PDF processing', async () => {
    await assert.rejects(detectAndValidateWorkerFormat(Buffer.from('not a PDF')));
    assert.throws(
      () => getWorkerDocumentFormatAdapter('image/png', 'text-extraction'),
      /does not support document format 'image\/png'/,
    );
  });
});
