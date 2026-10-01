import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { Op } from 'sequelize';
import { config } from './config.js';
import { sequelize } from './database.js';
import {
  ApplicationSetting,
  Document,
  DocumentAuditEvent,
  InboxItem,
  PipelineJob,
  PipelineJobEvent,
  User,
} from './models.js';
import { logger } from './logger.js';
import { resolveStoragePath } from './storage.js';
import { validatePdfBuffer } from './extraction.js';

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
  await ensureWritableDirectory(inboxPath);
  await ensureWritableDirectory(join(inboxPath, 'duplicates'));
  await ensureWritableDirectory(join(inboxPath, 'rejected'));

  const entries = await fs.readdir(inboxPath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.'));
  const completionStage = await getCompletionStage();
  let imported = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const entry of candidates) {
    const result = await importFile(inboxPath, entry.name, ownerUuid, completionStage);
    if (result === 'imported') imported += 1;
    if (result === 'duplicate') duplicates += 1;
    if (result === 'rejected') rejected += 1;
  }

  if (candidates.length > 0) {
    logger.info('Inbox scan completed', {
      candidates: candidates.length,
      imported,
      duplicates,
      rejected,
      ownerUuid,
    });
  }
}

async function importFile(
  inboxPath: string,
  filename: string,
  ownerUuid: string,
  completionStage: 'import' | 'ai-analysis',
): Promise<'imported' | 'duplicate' | 'rejected' | 'skipped'> {
  const sourcePath = join(inboxPath, filename);
  const initial = await statFile(sourcePath);
  if (!initial) return 'skipped';

  const inboxItem =
    (await InboxItem.findOne({
      where: { originalFilename: filename, status: { [Op.in]: ['new', 'processing'] } },
      order: [['createdAt', 'DESC']],
    })) ??
    (await InboxItem.create({
      uuid: randomUUID(),
      ownerUuid,
      documentUuid: null,
      originalFilename: safeFilename(filename),
      checksumSha256: null,
      sizeBytes: initial.size,
      status: 'new',
      aiStatus: 'pending',
      aiSuggestion: null,
      autoApplied: false,
      lastError: null,
      aiError: null,
    }));

  await inboxItem.update({ sizeBytes: initial.size, lastError: null });

  if (initial.size === 0) {
    await moveTo(sourcePath, join(inboxPath, 'rejected'), filename);
    await inboxItem.update({ status: 'rejected', lastError: 'The inbox file is empty' });
    return 'rejected';
  }

  if (Date.now() - initial.mtimeMs < config.inbox.stabilityMs) return 'skipped';
  if (extname(filename).toLowerCase() !== '.pdf' || initial.size > config.maxUploadBytes) {
    await moveTo(sourcePath, join(inboxPath, 'rejected'), filename);
    await inboxItem.update({
      status: 'rejected',
      lastError:
        extname(filename).toLowerCase() !== '.pdf'
          ? 'Unsupported file type'
          : 'File exceeds the configured upload limit',
    });
    logger.warn('Rejected inbox file', {
      filename,
      sizeBytes: initial.size,
      reason:
        extname(filename).toLowerCase() !== '.pdf' ? 'unsupported-file-type' : 'file-too-large',
    });
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

  await inboxItem.update({ status: 'processing' });

  try {
    const buffer = await fs.readFile(claimedPath);
    await validatePdfBuffer(buffer);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
    const duplicate = await Document.findOne({ where: { checksumSha256 } });
    if (duplicate) {
      await moveTo(claimedPath, join(inboxPath, 'duplicates'), filename);
      await inboxItem.update({
        status: 'duplicate',
        checksumSha256,
        documentUuid: duplicate.uuid,
        lastError: null,
      });
      logger.info('Skipped duplicate inbox document', {
        filename,
        duplicateDocumentUuid: duplicate.uuid,
        checksumSha256,
      });
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
        const document = await Document.create(
          {
            uuid: documentUuid,
            ownerUuid,
            originalFilename: safeFilename(filename),
            title: safeFilename(filename),
            mimeType: 'application/pdf',
            sizeBytes: buffer.length,
            checksumSha256,
            storageKey,
            thumbnailKey: null,
            pageCount: 1,
            issuerUuid: null,
            isNew: true,
            status: 'scanning',
          },
          { transaction },
        );
        await DocumentAuditEvent.create(
          {
            uuid: randomUUID(),
            documentUuid: document.uuid,
            ownerUuid,
            actorUuid: null,
            actorType: 'worker',
            eventType: 'uploaded',
            summary: 'Document imported from inbox',
            details: { source: 'inbox' },
          },
          { transaction },
        );
        const job = await PipelineJob.create(
          {
            uuid: randomUUID(),
            documentUuid: document.uuid,
            ownerUuid,
            kind: 'malware-scan',
            status: 'queued',
            attempts: 0,
            maxAttempts: 3,
            availableAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            startedAt: null,
            completedAt: null,
            lastError: null,
          },
          { transaction },
        );
        await PipelineJobEvent.create(
          {
            uuid: randomUUID(),
            jobUuid: job.uuid,
            type: 'queued',
            message: 'Queued malware scan from inbox import',
          },
          { transaction },
        );
        if (completionStage === 'import') {
          await inboxItem.destroy({ transaction });
        } else {
          await inboxItem.update(
            {
              status: 'imported',
              documentUuid: document.uuid,
              checksumSha256,
              sizeBytes: buffer.length,
              lastError: null,
            },
            { transaction },
          );
        }
      });
    } catch (error) {
      await moveTo(targetPath, join(inboxPath, 'rejected'), filename);
      throw error;
    }

    logger.info('Imported inbox document', {
      documentUuid,
      filename,
      storageKey,
      ownerUuid,
      completionStage,
      inboxItemRemoved: completionStage === 'import',
    });
    return 'imported';
  } catch (error) {
    await inboxItem
      .update({
        status: 'failed',
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      })
      .catch((updateError) =>
        logger.error('Unable to update inbox item after import failure', {
          filename,
          error: updateError,
        }),
      );
    await moveToIfPresent(claimedPath, join(inboxPath, 'rejected'), filename);
    logger.error('Inbox document import failed', {
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'rejected';
  }
}

async function getCompletionStage(): Promise<'import' | 'ai-analysis'> {
  const setting = await ApplicationSetting.findByPk('inbox.completionStage');
  return setting?.value === 'import'
    ? 'import'
    : setting?.value === 'ai-analysis'
      ? 'ai-analysis'
      : config.inbox.completionStage;
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
  await fs.rename(
    sourcePath,
    join(directory, `${Date.now()}-${randomUUID()}-${safeFilename(filename)}`),
  );
}

async function moveToIfPresent(
  sourcePath: string,
  directory: string,
  filename: string,
): Promise<void> {
  if (await statFile(sourcePath)) await moveTo(sourcePath, directory, filename);
}

async function ensureWritableDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o770 });
  // mkdir is affected by the process umask; chmod makes the NAS-facing mode explicit.
  await fs.chmod(directory, 0o770);
}

function safeFilename(filename: string): string {
  const value = basename(filename).replace(/[\r\n]/g, '_');
  return value.length <= 255 ? value : value.slice(0, 251) + '.pdf';
}
