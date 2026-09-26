import { promises as fs } from 'node:fs';
import { resolveStoragePath } from './storage.js';
export async function extractPdfPages(storageKey: string): Promise<{ pages: string[]; text: string }> {
  const mupdf = await import('mupdf'); const pdf = await fs.readFile(resolveStoragePath(storageKey)); const document = mupdf.Document.openDocument(pdf, 'application/pdf'); const pages: string[] = [];
  try { for (let i = 0; i < document.countPages(); i += 1) { const page = document.loadPage(i); try { pages.push(page.toStructuredText('preserve-whitespace').asText()); } finally { page.destroy(); } } } finally { document.destroy(); }
  return { pages, text: pages.join('\n\n').trim() };
}
