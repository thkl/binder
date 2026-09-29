import { promises as fs } from 'node:fs';
import { resolveStoragePath } from './storage.js';
import { normalizeOcrSpacing } from './text-normalization.js';

export interface ExtractedPdfPages {
  pages: string[];
  text: string;
  requiresOcr: boolean;
}

/**
 * Extracts searchable text from every page of a PDF.
 *
 * The original PDF is never modified. The returned page text is normalized
 * before it is persisted by the pipeline worker.
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
    requiresOcr: requiresOcr(text)
  };
}

/**
 * MuPDF uses the replacement character when a PDF text layer contains glyphs
 * without a usable Unicode mapping. Such text looks like `����` in the UI and
 * is not useful for search or AI analysis, even though it is technically
 * non-empty. Send it through OCR instead of persisting the broken text.
 */
export function requiresOcr(text: string): boolean {
  if (!text.trim()) return true;

  const replacementCharacters = [...text].filter((character) => character === '\uFFFD').length;
  if (replacementCharacters === 0) return false;

  const visibleCharacters = [...text].filter((character) => !/\s/u.test(character)).length;
  return replacementCharacters >= 3 || replacementCharacters / Math.max(visibleCharacters, 1) >= 0.01;
}
