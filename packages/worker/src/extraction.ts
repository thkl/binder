import { promises as fs } from 'node:fs';
import { resolveStoragePath } from './storage.js';
import { normalizeOcrSpacing } from './text-normalization.js';

export interface ExtractedPdfPages {
  pages: string[];
  text: string;
  requiresOcr: boolean;
}

/**
 * Validates a PDF signature and confirms MuPDF can open at least one page.
 *
 * @param {Buffer} pdfData - PDF bytes to validate or inspect.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
export async function validatePdfBuffer(pdfData: Buffer): Promise<void> {
  const header = pdfData.subarray(0, Math.min(pdfData.length, 1024));
  if (!header.includes(Buffer.from('%PDF-'))) {
    throw new Error('The file does not contain a valid PDF signature');
  }

  const mupdf = await import('mupdf');
  const document = mupdf.Document.openDocument(pdfData, 'application/pdf');
  try {
    if (document.countPages() < 1) {
      throw new Error('The PDF contains no pages');
    }
  } finally {
    document.destroy();
  }
}

/**
 * Extracts and normalizes text page by page without altering the source PDF.
 *
 * @param {string} storageKey - Storage-relative key of the document or derived file.
 * @returns {Promise<ExtractedPdfPages>} - Normalized text for each page, combined text, and whether OCR is required.
 */
export async function extractPdfPages(storageKey: string): Promise<ExtractedPdfPages> {
  const storagePath = resolveStoragePath(storageKey);
  const pdfData = await fs.readFile(storagePath);
  const mupdf = await import('mupdf');
  const document = mupdf.Document.openDocument(pdfData, 'application/pdf');
  const pages: string[] = [];

  try {
    const pageCount = document.countPages();

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = document.loadPage(pageIndex);

      try {
        const structuredText = page.toStructuredText('preserve-whitespace');
        const pageText = structuredText.asText();
        const normalizedPageText = normalizeOcrSpacing(pageText);

        pages.push(normalizedPageText);
      } finally {
        page.destroy();
      }
    }
  } finally {
    document.destroy();
  }

  const text = pages.join('\n\n').trim();

  return {
    pages,
    text,
    requiresOcr: requiresOcr(text),
  };
}

/**
 * Determines whether extracted text is empty or too corrupted to search reliably. MuPDF uses the replacement character when a PDF text layer has glyphs without a usable Unicode mapping. That text cannot support useful search or AI analysis, so it must go through OCR even when it is technically non-empty.
 *
 * @param {string} text - Extracted or user-entered text to process.
 * @returns {boolean} - `true` when the extracted text needs OCR; otherwise, `false`.
 */
export function requiresOcr(text: string): boolean {
  if (!text.trim()) return true;

  const replacementCharacters = [...text].filter((character) => character === '\uFFFD').length;
  if (replacementCharacters === 0) return false;

  const visibleCharacters = [...text].filter((character) => !/\s/u.test(character)).length;
  return (
    replacementCharacters >= 3 || replacementCharacters / Math.max(visibleCharacters, 1) >= 0.01
  );
}
