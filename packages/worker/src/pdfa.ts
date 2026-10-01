import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { runExternalCommand } from './ocr.js';
import { resolveStoragePath, storageExists } from './storage.js';

/**
 * Creates a validated PDF/A-2b derivative with OCRmyPDF/Ghostscript.
 * The original upload is never replaced. If OCR already produced a derived
 * PDF, it is used as the source so the archive keeps its searchable text.
 */
export async function runPdfa(originalStorageKey: string, documentUuid: string): Promise<string> {
  const ocrKey = `derived/${documentUuid}/ocr.pdf`;
  const sourceKey = (await storageExists(ocrKey)) ? ocrKey : originalStorageKey;
  const sourcePath = resolveStoragePath(sourceKey);
  const archiveKey = `derived/${documentUuid}/archive.pdf`;
  const archivePath = resolveStoragePath(archiveKey);
  const temporaryPath = `${archivePath}.${randomUUID()}.tmp.pdf`;

  await fs.mkdir(dirname(archivePath), { recursive: true, mode: 0o750 });
  logger.info('Starting PDF/A archive generation', {
    documentUuid,
    source: sourceKey,
    output: archiveKey,
    profile: 'pdfa-2b',
  });

  try {
    await runExternalCommand(
      'ocrmypdf',
      ['--skip-text', '--output-type', 'pdfa-2b', sourcePath, temporaryPath],
      documentUuid,
    );
    await fs.rename(temporaryPath, archivePath);
    logger.info('PDF/A archive generated and validated', {
      documentUuid,
      archiveKey,
      profile: 'pdfa-2b',
    });
    return archiveKey;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
