import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { Document } from './models.js';

export function resolveStoragePath(storageKey: string): string {
  const absolute = normalize(isAbsolute(storageKey) ? storageKey : join(config.storageRoot, storageKey));
  const rel = relative(config.storageRoot, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid document storage path');
  return absolute;
}
export async function writeDerivedText(documentUuid: string, text: string): Promise<void> {
  const target = resolveStoragePath(`derived/${documentUuid}/extracted.txt`); const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 }); await fs.writeFile(temporary, text, { encoding: 'utf8', mode: 0o640 }); await fs.rename(temporary, target);
}
export async function createThumbnail(storageKey: string, documentUuid: string): Promise<void> {
  const mupdf = await import('mupdf'); const pdf = await fs.readFile(resolveStoragePath(storageKey)); const document = mupdf.Document.openDocument(pdf, 'application/pdf');
  const target = resolveStoragePath(`derived/${documentUuid}/thumbnail.png`); const temporary = `${target}.${randomUUID()}.tmp`;
  try { if (document.countPages() < 1) throw new Error('PDF contains no pages'); const page = document.loadPage(0); try { const b = page.getBounds(); const pixmap = page.toPixmap(mupdf.Matrix.scale(480 / Math.max(1, b[2] - b[0]), 480 / Math.max(1, b[2] - b[0])), mupdf.ColorSpace.DeviceRGB); try { await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 }); await fs.writeFile(temporary, pixmap.asPNG(), { mode: 0o640 }); await fs.rename(temporary, target); } finally { pixmap.destroy(); } } finally { page.destroy(); } } finally { document.destroy(); }
  await Document.update({ thumbnailKey: `derived/${documentUuid}/thumbnail.png` }, { where: { uuid: documentUuid } });
}
