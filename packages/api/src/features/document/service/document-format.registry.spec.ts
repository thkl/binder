import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentFormatRegistry } from './document-format.registry.js';
import { PdfDocumentFormatAdapter } from './pdf-document-format.adapter.js';

describe('document format adapter registry', () => {
  it('detects PDF from content and delegates structural validation to the PDF adapter', async () => {
    const validate = vi.fn(async () => undefined);
    const registry = new DocumentFormatRegistry(
      new PdfDocumentFormatAdapter({ validatePdf: validate } as never),
    );

    await expect(registry.detectAndValidate(Buffer.from('%PDF-1.7\nfixture'))).resolves.toEqual({
      formatId: 'pdf',
      mimeType: 'application/pdf',
      extension: '.pdf',
    });
    expect(validate).toHaveBeenCalledOnce();
  });

  it('rejects unknown content without invoking a format parser', async () => {
    const validate = vi.fn(async () => undefined);
    const registry = new DocumentFormatRegistry(
      new PdfDocumentFormatAdapter({ validatePdf: validate } as never),
    );

    await assert.rejects(
      registry.detectAndValidate(Buffer.from('not a supported format')),
      (error: unknown) => error instanceof BadRequestException,
    );
    expect(validate).not.toHaveBeenCalled();
  });

  it('returns the registered adapter only when the MIME type and capability are supported', () => {
    const registry = new DocumentFormatRegistry(
      new PdfDocumentFormatAdapter({} as never),
    );
    const adapter = registry.getAdapterForMimeType('application/pdf', 'page-rotation');

    expect(adapter.descriptor.id).toBe('pdf');
    assert.throws(
      () => registry.getAdapterForMimeType('image/png', 'preview'),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
