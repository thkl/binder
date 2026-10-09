import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { Document } from './models.js';
import { logger } from './logger.js';

export function resolveStoragePath(storageKey: string): string {
  const absolute = normalize(
    isAbsolute(storageKey) ? storageKey : join(config.storageRoot, storageKey),
  );
  const rel = relative(config.storageRoot, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid document storage path');
  return absolute;
}
export async function storageExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(resolveStoragePath(storageKey));
    return true;
  } catch {
    return false;
  }
}
export function derivedDirectory(documentUuid: string, createdAt: Date): string {
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  return `derived/${year}/${month}/${documentUuid}`;
}

export async function writeDerivedText(
  documentUuid: string,
  text: string,
  createdAt: Date,
): Promise<void> {
  const target = resolveStoragePath(`${derivedDirectory(documentUuid, createdAt)}/extracted.txt`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 });
  await fs.writeFile(temporary, text, { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporary, target);
}
export async function createThumbnail(
  storageKey: string,
  documentUuid: string,
  createdAt: Date,
): Promise<void> {
  const mupdf = await import('mupdf');
  const pdf = await fs.readFile(resolveStoragePath(storageKey));
  const document = mupdf.Document.openDocument(pdf, 'application/pdf');
  const thumbnailKey = `${derivedDirectory(documentUuid, createdAt)}/thumbnail.png`;
  const target = resolveStoragePath(thumbnailKey);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    if (document.countPages() < 1) throw new Error('PDF contains no pages');
    const page = document.loadPage(0);
    try {
      const b = page.getBounds();
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(480 / Math.max(1, b[2] - b[0]), 480 / Math.max(1, b[2] - b[0])),
        mupdf.ColorSpace.DeviceRGB,
      );
      try {
        await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 });
        await fs.writeFile(temporary, pixmap.asPNG(), { mode: 0o640 });
        await fs.rename(temporary, target);
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
  await Document.update({ thumbnailKey }, { where: { uuid: documentUuid } });
}

export async function migrateLegacyDerivedStorage(): Promise<void> {
  const documents = await Document.findAll({
    attributes: ['uuid', 'createdAt', 'thumbnailKey', 'archiveKey'],
  });
  for (const document of documents) {
    const legacyKey = `derived/${document.uuid}`;
    const legacyPath = resolveStoragePath(legacyKey);
    try {
      await fs.access(legacyPath);
    } catch {
      continue;
    }

    const currentKey = derivedDirectory(document.uuid, document.createdAt);
    const currentPath = resolveStoragePath(currentKey);
    await fs.mkdir(currentPath, { recursive: true, mode: 0o750 });
    await moveDirectoryContents(legacyPath, currentPath);
    await fs.rm(legacyPath, { recursive: true, force: true });

    const legacyPrefix = `${legacyKey}/`;
    const updates: { thumbnailKey?: string; archiveKey?: string } = {};
    if (document.thumbnailKey?.startsWith(legacyPrefix)) {
      updates.thumbnailKey = `${currentKey}/${document.thumbnailKey.slice(legacyPrefix.length)}`;
    }
    if (document.archiveKey?.startsWith(legacyPrefix)) {
      updates.archiveKey = `${currentKey}/${document.archiveKey.slice(legacyPrefix.length)}`;
    }
    if (Object.keys(updates).length > 0) {
      await Document.update(updates, { where: { uuid: document.uuid } });
    }
    logger.info('Migrated legacy derived files', {
      documentUuid: document.uuid,
      from: legacyKey,
      to: currentKey,
    });
  }
}

async function moveDirectoryContents(source: string, target: string): Promise<void> {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true, mode: 0o750 });
      await moveDirectoryContents(sourcePath, targetPath);
      await fs.rm(sourcePath, { recursive: true, force: true });
    } else {
      try {
        await fs.rename(sourcePath, targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await fs.rm(sourcePath, { force: true });
      }
    }
  }
}
