import { promises as fs } from 'node:fs';
import { resolveStoragePath } from './storage.js';
import { normalizeOcrSpacing } from './text-normalization.js';

export interface ExtractedPdfPages {
  pages: string[];
  text: string;
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

  return {
    pages,
    text: pages.join('\n\n').trim()
  };
}
