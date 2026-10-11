import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { Document } from './models.js';
import { logger } from './logger.js';

/**
 * Resolves a storage-relative key and rejects paths that escape the configured storage root.
 *
 * @param {string} storageKey - Storage-relative key of the document or derived file.
 * @returns {string} - Resolves a storage-relative key and rejects paths that escape the configured storage root.
 */
export function resolveStoragePath(storageKey: string): string {
  const absolute = normalize(
    isAbsolute(storageKey) ? storageKey : join(config.storageRoot, storageKey),
  );
  const rel = relative(config.storageRoot, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid document storage path');
  return absolute;
}
/**
 * Checks whether a storage-relative file can be accessed.
 *
 * @param {string} storageKey - Storage-relative key of the document or derived file.
 * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
 */
export async function storageExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(resolveStoragePath(storageKey));
    return true;
  } catch {
    return false;
  }
}
/**
 * Builds the year/month/document directory used for generated document artifacts.
 *
 * @param {string} documentUuid - UUID of the document.
 * @param {Date} createdAt - Creation time used to derive storage paths.
 * @returns {string} - Builds the year/month/document directory used for generated document artifacts.
 */
export function derivedDirectory(documentUuid: string, createdAt: Date): string {
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  return `derived/${year}/${month}/${documentUuid}`;
}

/**
 * Atomically writes extracted text to the document's derived-storage directory.
 *
 * @param {string} documentUuid - UUID of the document.
 * @param {string} text - Extracted or user-entered text to process.
 * @param {Date} createdAt - Creation time used to derive storage paths.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
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
/**
 * Renders the first PDF page to a PNG, stores it atomically, and updates the document record.
 *
 * @param {string} storageKey - Storage-relative key of the document or derived file.
 * @param {string} documentUuid - UUID of the document.
 * @param {Date} createdAt - Creation time used to derive storage paths.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
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

/** Renders a validated JPEG or PNG source to Binder's cached thumbnail artifact. */
export async function createImageThumbnail(
  storageKey: string,
  documentUuid: string,
  createdAt: Date,
  mimeType: 'image/jpeg' | 'image/png',
): Promise<void> {
  const mupdf = await import('mupdf');
  const image = await fs.readFile(resolveStoragePath(storageKey));
  const document = mupdf.Document.openDocument(image, mimeType);
  const thumbnailKey = `${derivedDirectory(documentUuid, createdAt)}/thumbnail.png`;
  const target = resolveStoragePath(thumbnailKey);
  const temporary = `${target}.${randomUUID()}.tmp`;

  try {
    const page = document.loadPage(0);
    try {
      const bounds = page.getBounds();
      const width = Math.max(1, bounds[2] - bounds[0]);
      const height = Math.max(1, bounds[3] - bounds[1]);
      const scale = Math.min(480 / width, 1280 / height);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB);
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
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }

  await Document.update({ thumbnailKey }, { where: { uuid: documentUuid } });
}

/**
 * Moves artifacts from the legacy flat layout into date-partitioned derived storage.
 *
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
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
