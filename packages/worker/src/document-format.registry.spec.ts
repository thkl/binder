import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import {
  detectAndValidateWorkerFormat,
  getWorkerDocumentFormatAdapter,
  WORKER_DOCUMENT_FORMAT_IDS,
  WORKER_DOCUMENT_FORMATS,
} from './document-format.registry.js';
import { createPdfFixture } from './pdf-test-fixture.js';

describe('worker document format registry', () => {
  it('registers descriptors supplied by the worker adapters', () => {
    expect(WORKER_DOCUMENT_FORMATS.map((format) => format.id)).toEqual(['pdf', 'image']);
    expect(WORKER_DOCUMENT_FORMAT_IDS).toEqual(['pdf', 'image']);
  });

  it('detects and validates PDF import bytes with the registered adapter', async () => {
    await expect(
      detectAndValidateWorkerFormat(createPdfFixture(['worker fixture'])),
    ).resolves.toEqual({
      descriptor: WORKER_DOCUMENT_FORMATS[0],
      mimeType: 'application/pdf',
      extension: '.pdf',
    });
  });

  it('detects and validates PNG bytes independently of filenames and MIME hints', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7XcAAAAASUVORK5CYII=',
      'base64',
    );
    await expect(detectAndValidateWorkerFormat(png)).resolves.toEqual({
      descriptor: WORKER_DOCUMENT_FORMATS[1],
      mimeType: 'image/png',
      extension: '.png',
    });
  });

  it('rejects unknown content and MIME types without invoking PDF processing', async () => {
    await assert.rejects(detectAndValidateWorkerFormat(Buffer.from('not a PDF')));
    expect(getWorkerDocumentFormatAdapter('image/png', 'text-extraction').descriptor.id).toBe(
      'image',
    );
    assert.throws(
      () => getWorkerDocumentFormatAdapter('image/png', 'page-rotation'),
      /does not support page-rotation/,
    );
  });
});
