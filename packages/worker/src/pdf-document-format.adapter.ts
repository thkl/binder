import { PDF_DOCUMENT_FORMAT } from '@binder/common';
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
  readonly descriptor = PDF_DOCUMENT_FORMAT;

  validate(buffer: Buffer): Promise<void> {
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

  createPreview(storageKey: string, documentUuid: string, createdAt: Date): Promise<void> {
    return createThumbnail(storageKey, documentUuid, createdAt);
  }

  runOcr(
    storageKey: string,
    documentUuid: string,
    createdAt: Date,
    options?: OcrOptions,
  ): Promise<string> {
    return runOcr(storageKey, documentUuid, createdAt, options);
  }

  createArchive(storageKey: string, documentUuid: string, createdAt: Date): Promise<string> {
    return runPdfa(storageKey, documentUuid, createdAt);
  }
}
