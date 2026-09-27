import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { config } from './config.js';
import { sequelize } from './database.js';
import { Document, PipelineJob, PipelineJobEvent, User } from './models.js';
import { logger } from './logger.js';
import { resolveStoragePath } from './storage.js';

let lastScanAt = 0;

export async function importInboxDocuments(force = false): Promise<void> {
  if (!config.inbox.enabled) return;
  if (!force && Date.now() - lastScanAt < config.inbox.pollIntervalMs) return;
  lastScanAt = Date.now();

  const ownerUuid = config.inbox.importOwnerUuid;
  if (!ownerUuid) {
    logger.warn('Inbox import is enabled but no import owner is configured');
    return;
  }

  const owner = await User.findOne({ where: { uuid: ownerUuid, isActive: true } });
  if (!owner) {
    logger.error('Inbox import owner does not exist or is inactive', { ownerUuid });
    return;
  }

  const inboxPath = await resolveStoragePath(config.inbox.path);
  await fs.mkdir(inboxPath, { recursive: true, mode: 0o750 });
  await fs.mkdir(join(inboxPath, 'duplicates'), { recursive: true, mode: 0o750 });
  await fs.mkdir(join(inboxPath, 'rejected'), { recursive: true, mode: 0o750 });

  const entries = await fs.readdir(inboxPath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.'));
  let imported = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const entry of candidates) {
    const result = await importFile(inboxPath, entry.name, ownerUuid);
    if (result === 'imported') imported += 1;
    if (result === 'duplicate') duplicates += 1;
    if (result === 'rejected') rejected += 1;
  }

  if (candidates.length > 0) {
    logger.info('Inbox scan completed', { candidates: candidates.length, imported, duplicates, rejected, ownerUuid });
  }
}

async function importFile(inboxPath: string, filename: string, ownerUuid: string): Promise<'imported' | 'duplicate' | 'rejected' | 'skipped'> {
  const sourcePath = join(inboxPath, filename);
  const initial = await statFile(sourcePath);
  if (!initial || initial.size === 0) return 'skipped';

  if (Date.now() - initial.mtimeMs < config.inbox.stabilityMs) return 'skipped';
  if (extname(filename).toLowerCase() !== '.pdf' || initial.size > config.maxUploadBytes) {
    await moveTo(sourcePath, join(inboxPath, 'rejected'), filename);
    logger.warn('Rejected inbox file', { filename, sizeBytes: initial.size, reason: extname(filename).toLowerCase() !== '.pdf' ? 'unsupported-file-type' : 'file-too-large' });
    return 'rejected';
  }

  const claimId = randomUUID();
  const claimedPath = join(await resolveStoragePath('tmp/inbox'), `${claimId}.incoming`);
  await fs.mkdir(dirname(claimedPath), { recursive: true, mode: 0o750 });
  try {
    await fs.rename(sourcePath, claimedPath);
  } catch {
    // Another worker or a concurrent copy won the file. It will be seen on the next scan if needed.
    return 'skipped';
  }

  try {
    const buffer = await fs.readFile(claimedPath);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
    const duplicate = await Document.findOne({ where: { checksumSha256 } });
    if (duplicate) {
      await moveTo(claimedPath, join(inboxPath, 'duplicates'), filename);
      logger.info('Skipped duplicate inbox document', { filename, duplicateDocumentUuid: duplicate.uuid, checksumSha256 });
      return 'duplicate';
    }

    const documentUuid = randomUUID();
    const now = new Date();
    const storageKey = `documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${documentUuid}.pdf`;
    const targetPath = await resolveStoragePath(storageKey);
    await fs.mkdir(dirname(targetPath), { recursive: true, mode: 0o750 });
    await fs.rename(claimedPath, targetPath);

    try {
      await sequelize.transaction(async (transaction) => {
        const document = await Document.create({
          uuid: documentUuid,
          ownerUuid,
          originalFilename: safeFilename(filename),
          title: safeFilename(filename),
          mimeType: 'application/pdf',
          sizeBytes: buffer.length,
          checksumSha256,
          storageKey,
          thumbnailKey: null,
          status: 'uploaded'
        }, { transaction });
        const job = await PipelineJob.create({
          uuid: randomUUID(),
          documentUuid: document.uuid,
          ownerUuid,
          kind: 'text-extraction',
          status: 'queued',
          attempts: 0,
          maxAttempts: 3,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
          completedAt: null,
          lastError: null
        }, { transaction });
        await PipelineJobEvent.create({
          uuid: randomUUID(),
          jobUuid: job.uuid,
          type: 'queued',
          message: 'Queued from inbox import'
        }, { transaction });
      });
    } catch (error) {
      await moveTo(targetPath, join(inboxPath, 'rejected'), filename);
      throw error;
    }

    logger.info('Imported inbox document', { documentUuid, filename, storageKey, ownerUuid });
    return 'imported';
  } catch (error) {
    await moveToIfPresent(claimedPath, join(inboxPath, 'rejected'), filename);
    logger.error('Inbox document import failed', { filename, error: error instanceof Error ? error.message : String(error) });
    return 'rejected';
  }
}

async function statFile(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

async function moveTo(sourcePath: string, directory: string, filename: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  await fs.rename(sourcePath, join(directory, `${Date.now()}-${randomUUID()}-${safeFilename(filename)}`));
}

async function moveToIfPresent(sourcePath: string, directory: string, filename: string): Promise<void> {
  if (await statFile(sourcePath)) await moveTo(sourcePath, directory, filename);
}

function safeFilename(filename: string): string {
  const value = basename(filename).replace(/[\r\n]/g, '_');
  return value.length <= 255 ? value : value.slice(0, 251) + '.pdf';
}
