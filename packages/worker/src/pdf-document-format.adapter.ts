import type { DocumentFormatDescriptor } from '@binder/common';
import { extractPdfPages, validatePdfBuffer, type ExtractedPdfPages } from './extraction.js';
import { runOcr, type OcrOptions } from './ocr.js';
import { runPdfa } from './pdfa.js';
import { createThumbnail } from './storage.js';

export interface ExtractedTextSegment {
  segmentIndex: number;
  pageNumber: number | null;
  text: string;
}

export interface ExtractedDocumentText {
  segments: ExtractedTextSegment[];
  pageCount: number | null;
  text: string;
  requiresOcr: boolean;
}

/** PDF operations implemented by the worker's existing PDF tools. */
export class PdfDocumentFormatAdapter {
  readonly descriptor: DocumentFormatDescriptor = {
    id: 'pdf',
    displayName: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    capabilities: [
      'upload',
      'download',
      'preview',
      'text-extraction',
      'ocr',
      'file-analysis',
      'page-count',
      'page-rotation',
      'split',
      'compose',
      'pdfa',
    ],
  };

  validate(buffer: Buffer, _mimeType?: string): Promise<void> {
    return validatePdfBuffer(buffer);
  }

  async extractText(storageKey: string): Promise<ExtractedDocumentText> {
    const extracted: ExtractedPdfPages = await extractPdfPages(storageKey);
    return {
      segments: extracted.pages.map((text, index) => ({
        segmentIndex: index + 1,
        pageNumber: index + 1,
        text,
      })),
      pageCount: extracted.pages.length,
      text: extracted.text,
      requiresOcr: extracted.requiresOcr,
    };
  }

  createPreview(
    storageKey: string,
    documentUuid: string,
    createdAt: Date,
    _mimeType?: string,
  ): Promise<void> {
    return createThumbnail(storageKey, documentUuid, createdAt);
  }

  async runOcr(
    storageKey: string,
    documentUuid: string,
    createdAt: Date,
    options?: OcrOptions,
  ): Promise<ExtractedDocumentText> {
    const key = await runOcr(storageKey, documentUuid, createdAt, options);
    return this.extractText(key);
  }

  createArchive(storageKey: string, documentUuid: string, createdAt: Date): Promise<string> {
    return runPdfa(storageKey, documentUuid, createdAt);
  }
}
