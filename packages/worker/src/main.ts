import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ApplicationSetting, Document, PipelineJob, PipelineJobEvent, JobKind } from './models.js';
import { createLogger, format, transports, Logger } from 'winston';

interface ClaimedJob {
  jobUuid: string;
  documentUuid: string;
  ownerUuid: string;
  kind: JobKind;
  attempts: number;
  maxAttempts: number;
  storageKey: string;
}

interface WorkerConfig {
  storageRoot: string;
  workerId: string;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  reconcileIntervalMs: number;
}

const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

const config: WorkerConfig = {
  storageRoot: getDefaultStorageRoot(),
  workerId: process.env.PIPELINE_WORKER_ID ?? `${hostname()}-${process.pid}`,
  pollIntervalMs: 2_000,
  lockTimeoutMs: 15 * 60 * 1_000,
  reconcileIntervalMs: 30_000
};

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: readPositiveInteger('DATABASE_PORT', 5432),
  database: process.env.DATABASE_NAME ?? 'binder',
  username: process.env.DATABASE_USER ?? 'binder',
  password: process.env.DATABASE_PASSWORD ?? 'binder',
  logging: false,
  pool: { max: 4, min: 0, idle: 10_000 }
});
sequelize.addModels([ApplicationSetting, Document, PipelineJob, PipelineJobEvent]);

let stopping = false;

async function main(): Promise<void> {
  logger.info('Pipeline worker starting', {
    workerId: config.workerId,
    storageRoot: config.storageRoot,
    databaseHost: process.env.DATABASE_HOST ?? 'localhost',
    databasePort: readPositiveInteger('DATABASE_PORT', 5432),
    databaseName: process.env.DATABASE_NAME ?? 'binder'
  });

  await sequelize.authenticate();
  logger.info('Pipeline worker database connection established');
  await loadRuntimeConfiguration();
  logger.info('Pipeline worker runtime configuration loaded', {
    storageRoot: config.storageRoot,
    pollIntervalMs: config.pollIntervalMs,
    lockTimeoutMs: config.lockTimeoutMs,
    reconcileIntervalMs: config.reconcileIntervalMs
  });
  await recoverStaleJobs();
  await reconcileUploadedDocuments();
  await logQueueStatus();

  let lastReconciliation = Date.now();
  while (!stopping) {
    try {
      if (Date.now() - lastReconciliation >= config.reconcileIntervalMs) {
        await reconcileUploadedDocuments();
        lastReconciliation = Date.now();
      }
      const job = await claimNextJob();
      if (job) {
        await processJob(job);
        continue;
      }

      logger.debug('Pipeline queue is empty; waiting for jobs', { pollIntervalMs: config.pollIntervalMs });
    } catch (error) {
      logger.error('Pipeline polling cycle failed; will retry', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await delay(config.pollIntervalMs);
  }
}

async function reconcileUploadedDocuments(): Promise<void> {
  const documents = await Document.findAll({ where: { status: 'uploaded' } });
  let created = 0;

  for (const candidate of documents) {
    await sequelize.transaction(async (transaction) => {
      const document = await Document.findByPk(candidate.uuid, { transaction, lock: transaction.LOCK.UPDATE });
      if (!document || document.status !== 'uploaded') return;

      const existingJob = await PipelineJob.findOne({
        where: {
          documentUuid: document.uuid,
          kind: 'text-extraction',
          status: { [Op.in]: ['queued', 'running', 'succeeded'] }
        },
        transaction
      });
      if (existingJob) return;

      const job = await PipelineJob.create({
        uuid: randomUUID(),
        documentUuid: document.uuid,
        ownerUuid: document.ownerUuid,
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
        message: 'Queued by worker reconciliation'
      }, { transaction });
      created += 1;
    });
  }

  logger.info('Reconciled uploaded documents', { uploaded: documents.length, jobsCreated: created });
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  return sequelize.transaction(async (transaction) => {
    const job = await PipelineJob.findOne({
      where: {
        status: 'queued',
        availableAt: { [Op.lte]: new Date() }
      },
      include: [{ model: Document, required: true }],
      order: [['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    if (!job) {
      return null;
    }

    const attempts = job.attempts + 1;
    await job.update({
      status: 'running',
      attempts,
      lockedAt: new Date(),
      lockedBy: config.workerId,
      startedAt: job.startedAt ?? new Date()
    }, { transaction });

    await Document.update(
      { status: 'processing' },
      { where: { uuid: job.documentUuid, status: { [Op.in]: ['uploaded', 'failed'] } }, transaction }
    );

    await addEvent(transaction, job.uuid, 'claimed', `Claimed by ${config.workerId}`);
    logger.info('Claimed pipeline job', { jobUuid: job.uuid, kind: job.kind });
    return {
      jobUuid: job.uuid,
      documentUuid: job.documentUuid,
      ownerUuid: job.ownerUuid,
      kind: job.kind,
      attempts,
      maxAttempts: job.maxAttempts,
      storageKey: job.document?.storageKey ?? ''
    };
  });
}

async function processJob(job: ClaimedJob): Promise<void> {
  logger.info('Processing pipeline job', { jobUuid: job.jobUuid, documentUuid: job.documentUuid, kind: job.kind });

  try {
    switch (job.kind) {
      case 'text-extraction': {
        const text = await extractPdfText(job.storageKey);
        await writeDerivedText(job.documentUuid, text);
        await completeJob(job, text.trim().length === 0);
        break;
      }
      case 'thumbnail':
        await createThumbnail(job.storageKey, job.documentUuid);
        await completeJob(job, false);
        break;
      case 'ocr':
      case 'embedding':
        throw new Error(`${job.kind} processing is not configured yet`);
    }
  } catch (error) {
    await failJob(job, error instanceof Error ? error.message : String(error));
  }
}

async function extractPdfText(storageKey: string): Promise<string> {
  const mupdf = await import('mupdf');
  const pdf = await fs.readFile(resolveStoragePath(storageKey));
  const document = mupdf.Document.openDocument(pdf, 'application/pdf');
  const pages: string[] = [];

  try {
    for (let index = 0; index < document.countPages(); index += 1) {
      const page = document.loadPage(index);
      try {
        pages.push(page.toStructuredText('preserve-whitespace').asText());
      } finally {
        page.destroy();
      }
    }
  } finally {
    document.destroy();
  }

  return pages.join('\n\n').trim();
}

async function createThumbnail(storageKey: string, documentUuid: string): Promise<void> {
  const mupdf = await import('mupdf');
  const pdf = await fs.readFile(resolveStoragePath(storageKey));
  const document = mupdf.Document.openDocument(pdf, 'application/pdf');
  const thumbnailPath = resolveStoragePath(`derived/${documentUuid}/thumbnail.png`);
  const temporaryPath = `${thumbnailPath}.${randomUUID()}.tmp`;

  try {
    if (document.countPages() < 1) throw new Error('PDF contains no pages');
    const page = document.loadPage(0);
    try {
      const bounds = page.getBounds();
      const scale = 480 / Math.max(1, bounds[2] - bounds[0]);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB);
      try {
        await fs.mkdir(dirname(thumbnailPath), { recursive: true, mode: 0o750 });
        await fs.writeFile(temporaryPath, pixmap.asPNG(), { mode: 0o640 });
        await fs.rename(temporaryPath, thumbnailPath);
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }

  await Document.update(
    { thumbnailKey: `derived/${documentUuid}/thumbnail.png` },
    { where: { uuid: documentUuid } }
  );
}

async function writeDerivedText(documentUuid: string, text: string): Promise<void> {
  const target = resolveStoragePath(`derived/${documentUuid}/extracted.txt`);
  const temporaryPath = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o750 });
  await fs.writeFile(temporaryPath, text, { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryPath, target);
}

async function completeJob(job: ClaimedJob, needsOcr: boolean): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      { status: 'succeeded', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      { where: { uuid: job.jobUuid }, transaction }
    );

    if (needsOcr) {
      await Document.update({ status: 'processing' }, { where: { uuid: job.documentUuid }, transaction });
      const existingOcr = await PipelineJob.findOne({
        where: { documentUuid: job.documentUuid, kind: 'ocr', status: { [Op.in]: ['queued', 'running'] } },
        transaction
      });
      const ocrJob = existingOcr ?? await PipelineJob.create({
        uuid: randomUUID(), documentUuid: job.documentUuid, ownerUuid: job.ownerUuid,
        kind: 'ocr', status: 'queued', attempts: 0, maxAttempts: 3,
        availableAt: new Date(), lockedAt: null, lockedBy: null,
        startedAt: null, completedAt: null, lastError: null
      }, { transaction });
      await addEvent(transaction, job.jobUuid, 'ocr-required', 'No text layer found; queued OCR');
      if (!existingOcr) {
        await addEvent(transaction, ocrJob.uuid, 'queued', 'Queued ocr');
      }
    } else {
      await Document.update({ status: 'ready' }, { where: { uuid: job.documentUuid }, transaction });
      await addEvent(transaction, job.jobUuid, 'completed', 'Job completed');
    }
  });
  logger.info('Pipeline job completed', { jobUuid: job.jobUuid, kind: job.kind, needsOcr });
}

async function failJob(job: ClaimedJob, message: string): Promise<void> {
  const safeMessage = message.slice(0, 2000);
  try {
    const retry = job.attempts < job.maxAttempts;
    await sequelize.transaction(async (transaction) => {
      if (retry) {
      const delayMs = Math.min(5 * 60 * 1000, 1000 * (2 ** Math.max(0, job.attempts - 1)));
      await PipelineJob.update(
        { status: 'queued', availableAt: new Date(Date.now() + delayMs), lockedAt: null, lockedBy: null, lastError: safeMessage },
        { where: { uuid: job.jobUuid }, transaction }
      );
      await addEvent(transaction, job.jobUuid, 'retry-scheduled', `Retry scheduled: ${safeMessage}`);
      } else {
      await PipelineJob.update(
        { status: 'failed', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: safeMessage },
        { where: { uuid: job.jobUuid }, transaction }
      );
      await Document.update({ status: 'failed' }, { where: { uuid: job.documentUuid }, transaction });
      await addEvent(transaction, job.jobUuid, 'failed', safeMessage);
      }
    });
    logger.error('Pipeline job failed', { jobUuid: job.jobUuid, retry, error: safeMessage });
  } catch (error) {
    logger.error('Unable to record pipeline failure', { jobUuid: job.jobUuid, error });
  }
}

async function recoverStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - config.lockTimeoutMs);
  const staleJobs = await PipelineJob.findAll({
    where: { status: 'running', lockedAt: { [Op.lt]: cutoff } }
  });
  for (const job of staleJobs) {
    const error = `${job.lastError ? `${job.lastError}; ` : ''}Recovered after worker lock timeout`.slice(0, 2000);
    await job.update({ status: 'queued', lockedAt: null, lockedBy: null, lastError: error, availableAt: new Date() });
    await PipelineJobEvent.create({ jobUuid: job.uuid, type: 'recovered', message: error });
  }
  const count = staleJobs.length;
  logger.info('Checked for stale pipeline jobs', { recovered: count });
}

async function logQueueStatus(): Promise<void> {
  const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
  const counts = await Promise.all(statuses.map(async (status) => [status, await PipelineJob.count({ where: { status } })] as const));
  logger.info('Pipeline queue status', {
    jobs: Object.fromEntries(counts)
  });
}

async function addEvent(transaction: Transaction, jobUuid: string, type: string, message: string): Promise<void> {
  await PipelineJobEvent.create(
    { uuid: randomUUID(), jobUuid, type, message: message.slice(0, 2000) },
    { transaction }
  );
}

function resolveStoragePath(storageKey: string): string {
  const absolutePath = normalize(join(config.storageRoot, storageKey));
  const relativePath = relative(config.storageRoot, absolutePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Invalid document storage path');
  }
  return absolutePath;
}

async function loadRuntimeConfiguration(): Promise<void> {
  const settings = await ApplicationSetting.findAll({
    where: { key: { [Op.in]: ['documents.storageRoot', 'pipeline.pollIntervalMs', 'pipeline.lockTimeoutMs', 'pipeline.reconcileIntervalMs'] } }
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const appRoot = process.env.APP_ROOT_PATH ?? process.cwd();
  const configuredStorageRoot = values.get('documents.storageRoot') ?? join(appRoot, 'storage');
  config.storageRoot = isAbsolute(configuredStorageRoot) ? configuredStorageRoot : resolve(appRoot, configuredStorageRoot);
  config.pollIntervalMs = readSettingInteger(values, 'pipeline.pollIntervalMs', config.pollIntervalMs);
  config.lockTimeoutMs = readSettingInteger(values, 'pipeline.lockTimeoutMs', config.lockTimeoutMs);
  config.reconcileIntervalMs = readSettingInteger(values, 'pipeline.reconcileIntervalMs', config.reconcileIntervalMs);
}

function getDefaultStorageRoot(): string {
  const appRoot = process.env.APP_ROOT_PATH ?? process.cwd();
  return resolve(appRoot, 'storage');
}

function readSettingInteger(values: Map<string, string>, key: string, fallback: number): number {
  const value = values.get(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    logger.warn('Ignoring invalid database runtime setting', { key });
    return fallback;
  }
  return parsed;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info('Pipeline worker stopping', { signal });
  void sequelize.close().then(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

void main().catch((error) => {
  logger.error('Pipeline worker stopped unexpectedly', { error });
  void sequelize.close().finally(() => process.exit(1));
});
