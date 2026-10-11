import { describe, expect, it } from 'vitest';
import { DOCUMENT_FORMAT_CATALOG } from '@binder/common';
import { DocumentFormatsController } from './document-formats.controller.js';
import { DocumentFormatRegistry } from '../service/document-format.registry.js';
import { PdfDocumentFormatAdapter } from '../service/pdf-document-format.adapter.js';

describe('document formats endpoint', () => {
  it('returns the formats supported by the API build', () => {
    const controller = new DocumentFormatsController(
      new DocumentFormatRegistry(
        new PdfDocumentFormatAdapter({ validatePdf: async () => undefined } as never),
      ),
    );

    expect(controller.getFormats()).toEqual({ formats: DOCUMENT_FORMAT_CATALOG });
  });

  it('returns defensive copies so callers cannot mutate the shared catalog', () => {
    const registry = new DocumentFormatRegistry(
      new PdfDocumentFormatAdapter({ validatePdf: async () => undefined } as never),
    );
    const firstResponse = registry.getSupportedFormats();
    firstResponse.formats[0].extensions.push('.changed');

    expect(registry.getSupportedFormats().formats[0].extensions).toEqual(['.pdf']);
  });
});
