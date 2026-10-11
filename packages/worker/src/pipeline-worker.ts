import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { config } from './config.js';
import { sequelize } from './database.js';
import {
  Document,
  DocumentAuditEvent,
  InboxItem,
  PipelineJob,
  PipelineJobEvent,
  MaintenanceRequest,
  JobKind,
} from './models.js';
import { logger } from './logger.js';
import { migrateLegacyDerivedStorage, writeDerivedText } from './storage.js';
import { getWorkerDocumentFormatAdapter } from './document-format.registry.js';
import { embedDocument } from './embeddings.js';
import { importInboxDocuments } from './inbox-importer.js';
import { matchDocumentIssuer } from './issuer-matcher.js';
import { MalwareDetectedError, scanDocument } from './malware-scanner.js';
import { importEmailMessages } from './email-importer.js';
import { isRecoveryActive, setRecoveryActive } from './recovery-state.js';
export interface ClaimedJob {
  /** Unique queue row identifier used to finish or retry the claimed work. */
  jobUuid: string;
  /** Document whose file is being processed. */
  documentUuid: string;
  /** Owner used to scope document and audit updates. */
  ownerUuid: string;
  /** Processing stage claimed from the durable queue. */
  kind: JobKind;
  /** Number of prior attempts, used to enforce retry limits. */
  attempts: number;
  /** Maximum attempts allowed before the job is marked failed. */
  maxAttempts: number;
  /** Storage key resolved by the database row for the source PDF. */
  storageKey: string;
  /** Canonical MIME type used to select a registered processing adapter. */
  mimeType: string;
  /** Creation time used for queue ordering and diagnostics. */
  createdAt: Date;
}
let stopping = false;
/**
 * Initializes recovery and import work, then polls the durable queue until shutdown is requested. Each cycle pauses during restore, imports new inbox items, reconciles missed jobs, and claims work.
 *
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
export async function startPipelineWorker(): Promise<void> {
  logger.info('Pipeline worker starting', {
    workerId: config.workerId,
    storageRoot: config.storageRoot,
    inboxEnabled: config.inbox.enabled,
  });
  if (await shouldPauseForRecovery()) {
    logger.info('Pipeline worker paused because recovery is queued or running');
  } else {
    await recoverStaleJobs();
    await migrateLegacyDerivedStorage();
    await importInboxDocuments(true);
    await importEmailMessages(true);
    await reconcileUploadedDocuments();
    await logQueueStatus();
  }
  let last = Date.now();
  while (!stopping) {
    try {
      if (await shouldPauseForRecovery()) {
        await delay(config.pollIntervalMs);
        continue;
      }
      await importInboxDocuments();
      await importEmailMessages();
      if (Date.now() - last >= config.reconcileIntervalMs) {
        await reconcileUploadedDocuments();
        last = Date.now();
      }
      const job = await claimNextJob();
      if (job) {
        await processClaimedJob(job);
        continue;
      }
      logger.debug('Pipeline queue is empty; waiting for jobs', {
        pollIntervalMs: config.pollIntervalMs,
      });
    } catch (error) {
      logger.error('Pipeline polling cycle failed; will retry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await delay(config.pollIntervalMs);
  }
}

/**
 * Detects pending/running restore work and pauses document processing while recovery is active.
 *
 * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
 */
async function shouldPauseForRecovery(): Promise<boolean> {
  if (isRecoveryActive()) return true;
  const pending = await MaintenanceRequest.findOne({
    where: { jobKey: 'restore' },
    attributes: ['uuid'],
  });
  if (pending) setRecoveryActive(true);
  return Boolean(pending);
}
/**
 * Requests a graceful stop after the current pipeline job finishes.
 *
 * @returns {void} - No value.
 */
export function requestShutdown(): void {
  stopping = true;
}
/**
 * Recreates missing initial jobs for uploaded/scanning documents after interruption.
 *
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function reconcileUploadedDocuments(): Promise<void> {
  const documents = await Document.findAll({
    where: { status: { [Op.in]: ['uploaded', 'scanning'] } },
  });
  let created = 0;
  const initialJobKind = config.malwareScan.required ? 'malware-scan' : 'text-extraction';

  for (const candidate of documents) {
    await sequelize.transaction(async (transaction) => {
      const document = await Document.findByPk(candidate.uuid, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!document || !['uploaded', 'scanning'].includes(document.status)) return;

      if (!config.malwareScan.required) {
        await PipelineJob.update(
          {
            status: 'cancelled',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: 'Malware scanning disabled by configuration',
          },
          {
            where: {
              documentUuid: document.uuid,
              kind: 'malware-scan',
              status: 'queued',
            },
            transaction,
          },
        );
      }

      const existingInitialJob = await PipelineJob.findOne({
        where: {
          documentUuid: document.uuid,
          kind: initialJobKind,
          status: { [Op.in]: ['queued', 'running', 'succeeded'] },
        },
        transaction,
      });
      if (existingInitialJob) {
        if (!config.malwareScan.required && document.status === 'scanning') {
          await document.update({ status: 'processing' }, { transaction });
        }
        return;
      }

      if (config.malwareScan.required) {
        await PipelineJob.update(
          {
            status: 'cancelled',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: 'Superseded by mandatory malware scan',
          },
          {
            where: {
              documentUuid: document.uuid,
              status: 'queued',
              kind: { [Op.ne]: 'malware-scan' },
            },
            transaction,
          },
        );
      }

      await document.update(
        { status: config.malwareScan.required ? 'scanning' : 'processing' },
        { transaction },
      );
      await queueInitialJob(
        transaction,
        document,
        initialJobKind,
        config.malwareScan.required
          ? 'Queued mandatory malware scan by worker reconciliation'
          : 'Queued text extraction because malware scanning is disabled',
      );
      created += 1;
    });
  }

  logger.info('Reconciled unscanned documents', {
    candidates: documents.length,
    initialJobsCreated: created,
    initialJobKind,
  });
}

/**
 * Creates the first processing job for a document if its initial stage is missing.
 *
 * @param {Transaction} transaction - Database transaction for related writes.
 * @param {Document} document - Document being read or updated.
 * @param {JobKind} kind - Resource kind or operation type.
 * @param {string} message - Message to send or store as the failure reason.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function queueInitialJob(
  transaction: Transaction,
  document: Document,
  kind: JobKind,
  message: string,
): Promise<void> {
  const job = await PipelineJob.create(
    {
      uuid: randomUUID(),
      documentUuid: document.uuid,
      ownerUuid: document.ownerUuid,
      kind,
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
      message,
    },
    { transaction },
  );
}
/**
 * Atomically claims the oldest eligible job without waiting on other workers' locks.
 *
 * @returns {Promise<ClaimedJob | null>} - Atomically claims the oldest eligible job without waiting on other workers' locks.
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
  return sequelize.transaction(async (transaction) => {
    const candidates = await PipelineJob.findAll({
      where: { status: 'queued', availableAt: { [Op.lte]: new Date() } },
      include: [{ model: Document, required: true }],
      order: [['createdAt', 'ASC']],
      limit: 50,
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
    });
    // SKIP LOCKED lets multiple worker processes claim different jobs without
    // waiting on one another; the document-state filter prevents stale OCR or
    // extraction jobs from running while scanning/quarantine is in progress.
    const job = candidates.find(
      (candidate) =>
        candidate.kind === 'malware-scan' ||
        !['uploaded', 'scanning', 'quarantined'].includes(
          candidate.document?.status ?? 'quarantined',
        ),
    );
    if (!job) return null;
    const attempts = job.attempts + 1;
    await job.update(
      {
        status: 'running',
        attempts,
        lockedAt: new Date(),
        lockedBy: config.workerId,
        startedAt: job.startedAt ?? new Date(),
      },
      { transaction },
    );
    const documentStatus = job.kind === 'malware-scan' ? 'scanning' : 'processing';
    await Document.update(
      { status: documentStatus },
      {
        where: { uuid: job.documentUuid, status: { [Op.in]: ['uploaded', 'scanning', 'failed'] } },
        transaction,
      },
    );
    if (job.kind === 'pdfa') {
      await Document.update(
        { archiveStatus: 'processing', archiveError: null },
        { where: { uuid: job.documentUuid }, transaction },
      );
    }
    await addEvent(transaction, job.uuid, 'claimed', `Claimed by ${config.workerId}`);
    await addDocumentAudit(
      transaction,
      job,
      'processing-started',
      `Document processing started for ${job.kind}`,
      { jobKind: job.kind },
    );
    logger.info('Claimed pipeline job', { jobUuid: job.uuid, kind: job.kind });
    return {
      jobUuid: job.uuid,
      documentUuid: job.documentUuid,
      ownerUuid: job.ownerUuid,
      kind: job.kind,
      attempts,
      maxAttempts: job.maxAttempts,
      storageKey: job.document?.storageKey ?? '',
      mimeType: job.document?.mimeType ?? '',
      createdAt: job.document?.createdAt ?? new Date(),
    };
  });
}
/**
 * Runs the handler for one claimed stage and routes errors to retry/quarantine logic.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
export async function processClaimedJob(job: ClaimedJob): Promise<void> {
  logger.info('Processing pipeline job', {
    jobUuid: job.jobUuid,
    documentUuid: job.documentUuid,
    kind: job.kind,
  });

  try {
    switch (job.kind) {
      case 'malware-scan':
        try {
          await scanDocument(job.storageKey, job.documentUuid);
          await completeMalwareScan(job);
        } catch (error) {
          if (error instanceof MalwareDetectedError) {
            await quarantineJob(job, error.message);
          } else {
            await failJob(job, error instanceof Error ? error.message : String(error));
          }
        }
        break;

      case 'text-extraction': {
        const adapter = getWorkerDocumentFormatAdapter(job.mimeType, 'text-extraction');
        const extracted = await adapter.extractText(job.storageKey);

        if (extracted.requiresOcr) {
          logger.warn('No usable text found; queueing OCR', {
            documentUuid: job.documentUuid,
            jobUuid: job.jobUuid,
          });
          await writeDerivedText(job.documentUuid, '', job.createdAt);
          await persistSegments(job.documentUuid, [], extracted.pageCount);
          await completeJob(job, true);
          break;
        }

        await writeDerivedText(job.documentUuid, extracted.text, job.createdAt);
        await persistSegments(job.documentUuid, extracted.segments, extracted.pageCount);
        await matchDocumentIssuer(job.documentUuid, job.ownerUuid, extracted.text);
        await completeJob(job, false);
        break;
      }

      case 'thumbnail':
        await getWorkerDocumentFormatAdapter(job.mimeType, 'preview').createPreview(
          job.storageKey,
          job.documentUuid,
          job.createdAt,
          job.mimeType,
        );
        await completeJob(job, false);
        break;

      case 'ocr': {
        const adapter = getWorkerDocumentFormatAdapter(job.mimeType, 'ocr');
        // With deskew enabled, skip-text can leave a broken existing text layer
        // untouched. Detect that case before OCR so it goes straight to the
        // force pass instead of doing two complete OCR runs.
        const sourceText = config.ocrDeskew ? await adapter.extractText(job.storageKey) : undefined;
        const needsForceForBrokenText = Boolean(
          sourceText?.requiresOcr && sourceText.text.trim().length > 0,
        );
        let extracted = await adapter.runOcr(
          job.storageKey,
          job.documentUuid,
          job.createdAt,
          needsForceForBrokenText ? { forceOcr: true } : {},
        );

        if (extracted.requiresOcr) {
          logger.warn('OCR pass produced no usable text; forcing OCR', {
            documentUuid: job.documentUuid,
            jobUuid: job.jobUuid,
          });
          extracted = await adapter.runOcr(job.storageKey, job.documentUuid, job.createdAt, {
            forceOcr: true,
          });
        }

        if (extracted.requiresOcr) {
          throw new Error('OCR completed but produced no usable searchable text');
        }

        await writeDerivedText(job.documentUuid, extracted.text, job.createdAt);
        await persistSegments(job.documentUuid, extracted.segments, extracted.pageCount);
        await matchDocumentIssuer(job.documentUuid, job.ownerUuid, extracted.text);
        await completeJob(job, false);
        break;
      }

      case 'embedding':
        await embedDocument(job.documentUuid);
        await completeJob(job, false);
        break;

      case 'pdfa': {
        const archiveKey = await getWorkerDocumentFormatAdapter(job.mimeType, 'pdfa').createArchive(
          job.storageKey,
          job.documentUuid,
          job.createdAt,
        );
        await completePdfaJob(job, archiveKey);
        break;
      }
    }
  } catch (error) {
    await failJob(job, error instanceof Error ? error.message : String(error));
  }
}
/**
 * Marks a clean scan complete and queues text extraction, or quarantines infected input.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function completeMalwareScan(job: ClaimedJob): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      {
        status: 'succeeded',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      { where: { uuid: job.jobUuid }, transaction },
    );

    await Document.update(
      { status: 'processing' },
      { where: { uuid: job.documentUuid }, transaction },
    );
    await addEvent(transaction, job.jobUuid, 'scan-clean', 'Malware scan completed successfully');
    await addDocumentAudit(
      transaction,
      job,
      'processing-succeeded',
      'Malware scan completed successfully',
      { jobKind: job.kind },
    );
    await queueFollowup(
      transaction,
      job,
      'text-extraction',
      'Queued text extraction after clean malware scan',
    );
  });

  logger.info('Malware scan passed; queued document extraction', {
    documentUuid: job.documentUuid,
    jobUuid: job.jobUuid,
  });
}

/**
 * Marks a malware-positive document as quarantined and records the reason for review.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @param {string} message - Message to send or store as the failure reason.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function quarantineJob(job: ClaimedJob, message: string): Promise<void> {
  const safeMessage = message.slice(0, 2000);
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      {
        status: 'failed',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: safeMessage,
      },
      { where: { uuid: job.jobUuid }, transaction },
    );
    await Document.update(
      { status: 'quarantined' },
      { where: { uuid: job.documentUuid }, transaction },
    );
    await addEvent(transaction, job.jobUuid, 'quarantined', safeMessage);
    await addDocumentAudit(transaction, job, 'quarantined', 'Document quarantined', {
      jobKind: job.kind,
    });
  });

  logger.error('Document quarantined after malware detection', {
    documentUuid: job.documentUuid,
    jobUuid: job.jobUuid,
  });
}
/**
 * Stores extracted text segments and updates physical page count when available.
 *
 * @param {string} documentUuid - UUID of the document.
 * @param {Array<{segmentIndex: number; pageNumber: number | null; text: string}>} segments - Ordered text units from the format adapter.
 * @param {number | null} pageCount - Physical page count, or null for an unpaged format.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function persistSegments(
  documentUuid: string,
  segments: Array<{ segmentIndex: number; pageNumber: number | null; text: string }>,
  pageCount: number | null,
): Promise<void> {
  const { DocumentPage } = await import('./document-page.model.js');
  await sequelize.transaction(async (transaction) => {
    await DocumentPage.destroy({ where: { documentUuid }, transaction });
    if (segments.length)
      await DocumentPage.bulkCreate(
        segments.map((segment) => ({ uuid: randomUUID(), documentUuid, ...segment })),
        { transaction },
      );
    await Document.update({ pageCount }, { where: { uuid: documentUuid }, transaction });
  });
  logger.info('Persisted extracted document pages', {
    documentUuid,
    pageCount,
    segmentCount: segments.length,
    textLength: segments.reduce((total, segment) => total + segment.text.length, 0),
  });
}
/**
 * Completes text extraction and queues follow-up OCR, embeddings, or metadata analysis.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @param {boolean} needsOcr - Whether OCR should follow text extraction.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function completeJob(job: ClaimedJob, needsOcr: boolean): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      {
        status: 'succeeded',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      { where: { uuid: job.jobUuid }, transaction },
    );

    await addDocumentAudit(
      transaction,
      job,
      'processing-succeeded',
      `${job.kind} processing completed`,
      { jobKind: job.kind },
    );

    if (needsOcr) {
      await Document.update(
        { status: 'processing' },
        { where: { uuid: job.documentUuid }, transaction },
      );
      await queueFollowup(transaction, job, 'ocr', 'No usable text layer found; queued OCR');
    } else if (job.kind === 'text-extraction' || job.kind === 'ocr') {
      await resetInboxAnalysis(transaction, job);
      await Document.update(
        { status: 'processing' },
        { where: { uuid: job.documentUuid }, transaction },
      );
      if (config.embeddings.enabled) {
        await queueFollowup(transaction, job, 'embedding', 'Queued hosted embeddings');
      }
      if (config.pdfa.enabled) {
        await queueFollowup(transaction, job, 'pdfa', 'Queued PDF/A archive generation');
      }
      if (!config.embeddings.enabled && !config.pdfa.enabled) {
        await Document.update(
          { status: 'ready' },
          { where: { uuid: job.documentUuid }, transaction },
        );
        await addEvent(transaction, job.jobUuid, 'completed', 'Job completed');
      }
    } else {
      await Document.update(
        { status: 'ready' },
        { where: { uuid: job.documentUuid }, transaction },
      );
      await addEvent(transaction, job.jobUuid, 'completed', 'Job completed');
    }
  });

  logger.info('Pipeline job completed', {
    jobUuid: job.jobUuid,
    kind: job.kind,
    needsOcr,
  });
}

/**
 * Resets inbox AI state when a document's extracted text changes.
 *
 * @param {Transaction} transaction - Database transaction for related writes.
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function resetInboxAnalysis(transaction: Transaction, job: ClaimedJob): Promise<void> {
  const [updated] = await InboxItem.update(
    {
      status: 'imported',
      aiStatus: 'pending',
      aiSuggestion: null,
      autoApplied: false,
      aiError: null,
      lastError: null,
    },
    {
      where: {
        documentUuid: job.documentUuid,
        status: 'imported',
      },
      transaction,
    },
  );

  if (updated > 0) {
    logger.info('Reset automatic AI analysis after document text was refreshed', {
      documentUuid: job.documentUuid,
      jobUuid: job.jobUuid,
      jobKind: job.kind,
    });
  }
}

/**
 * Saves the completed PDF/A archive key and marks archive generation ready.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @param {string} archiveKey - Storage key of the generated archive.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function completePdfaJob(job: ClaimedJob, archiveKey: string): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      {
        status: 'succeeded',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      { where: { uuid: job.jobUuid }, transaction },
    );
    await Document.update(
      { archiveKey, archiveStatus: 'ready', archiveError: null },
      { where: { uuid: job.documentUuid }, transaction },
    );
    const activePostProcessingJobs = await PipelineJob.count({
      where: {
        documentUuid: job.documentUuid,
        kind: { [Op.in]: ['embedding', 'pdfa'] },
        status: { [Op.in]: ['queued', 'running'] },
      },
      transaction,
    });
    if (activePostProcessingJobs === 0) {
      await Document.update(
        { status: 'ready' },
        { where: { uuid: job.documentUuid }, transaction },
      );
    }
    await addEvent(transaction, job.jobUuid, 'completed', 'PDF/A archive generated');
    await addDocumentAudit(transaction, job, 'archive-generated', 'PDF/A archive generated', {
      jobKind: job.kind,
    });
  });
  logger.info('PDF/A pipeline job completed', { jobUuid: job.jobUuid, archiveKey });
}
/**
 * Enqueues a later processing stage while preserving the document's current pipeline state.
 *
 * @param {Transaction} transaction - Database transaction for related writes.
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @param {JobKind} kind - Resource kind or operation type.
 * @param {string} message - Message to send or store as the failure reason.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function queueFollowup(
  transaction: Transaction,
  job: ClaimedJob,
  kind: JobKind,
  message: string,
): Promise<void> {
  const existing = await PipelineJob.findOne({
    where: { documentUuid: job.documentUuid, kind, status: { [Op.in]: ['queued', 'running'] } },
    transaction,
  });
  await addEvent(
    transaction,
    job.jobUuid,
    kind === 'ocr' ? 'ocr-required' : kind === 'embedding' ? 'embedding-queued' : 'pdfa-queued',
    message,
  );
  if (kind === 'pdfa') {
    await Document.update(
      { archiveStatus: 'queued', archiveError: null },
      { where: { uuid: job.documentUuid }, transaction },
    );
    await addDocumentAudit(transaction, job, 'archive-queued', 'PDF/A archive generation queued', {
      jobKind: kind,
    });
  }
  if (!existing) {
    const next = await PipelineJob.create(
      {
        uuid: randomUUID(),
        documentUuid: job.documentUuid,
        ownerUuid: job.ownerUuid,
        kind,
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
    await addEvent(transaction, next.uuid, 'queued', `Queued ${kind}`);
  }
}
/**
 * Marks a failed attempt and requeues it when retries remain.
 *
 * @param {ClaimedJob} job - Claimed pipeline job being processed.
 * @param {string} message - Message to send or store as the failure reason.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function failJob(job: ClaimedJob, message: string): Promise<void> {
  const safe = message.slice(0, 2000);
  try {
    const retry = job.attempts < job.maxAttempts;
    await sequelize.transaction(async (transaction) => {
      if (retry) {
        const delayMs = Math.min(300000, 1000 * 2 ** Math.max(0, job.attempts - 1));
        await PipelineJob.update(
          {
            status: 'queued',
            availableAt: new Date(Date.now() + delayMs),
            lockedAt: null,
            lockedBy: null,
            lastError: safe,
          },
          { where: { uuid: job.jobUuid }, transaction },
        );
        if (job.kind === 'pdfa') {
          await Document.update(
            { archiveStatus: 'queued', archiveError: safe },
            { where: { uuid: job.documentUuid }, transaction },
          );
        }
        await addEvent(transaction, job.jobUuid, 'retry-scheduled', `Retry scheduled: ${safe}`);
      } else {
        await PipelineJob.update(
          {
            status: 'failed',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: safe,
          },
          { where: { uuid: job.jobUuid }, transaction },
        );
        if (job.kind === 'pdfa') {
          await Document.update(
            { archiveStatus: 'failed', archiveError: safe },
            { where: { uuid: job.documentUuid }, transaction },
          );
          const activePostProcessingJobs = await PipelineJob.count({
            where: {
              documentUuid: job.documentUuid,
              kind: { [Op.in]: ['embedding', 'pdfa'] },
              status: { [Op.in]: ['queued', 'running'] },
            },
            transaction,
          });
          if (activePostProcessingJobs === 0) {
            await Document.update(
              { status: 'ready' },
              { where: { uuid: job.documentUuid }, transaction },
            );
          }
        } else {
          await Document.update(
            { status: job.kind === 'malware-scan' ? 'quarantined' : 'failed' },
            { where: { uuid: job.documentUuid }, transaction },
          );
        }
        await addEvent(
          transaction,
          job.jobUuid,
          job.kind === 'malware-scan' ? 'quarantined' : 'failed',
          safe,
        );
        await addDocumentAudit(
          transaction,
          job,
          job.kind === 'pdfa' ? 'archive-failed' : 'processing-failed',
          job.kind === 'pdfa' ? 'PDF/A archive generation failed' : 'Document processing failed',
          { jobKind: job.kind },
        );
      }
    });
    logger.error('Pipeline job failed', { jobUuid: job.jobUuid, retry, error: safe });
  } catch (error) {
    logger.error('Unable to record pipeline failure', { jobUuid: job.jobUuid, error });
  }
}
/**
 * Reclaims jobs left running by a worker that exited without completing them.
 *
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function recoverStaleJobs(): Promise<void> {
  const stale = await PipelineJob.findAll({
    where: {
      status: 'running',
      lockedAt: { [Op.lt]: new Date(Date.now() - config.lockTimeoutMs) },
    },
  });
  for (const job of stale) {
    const message =
      `${job.lastError ? `${job.lastError}; ` : ''}Recovered after worker lock timeout`.slice(
        0,
        2000,
      );
    await job.update({
      status: 'queued',
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      availableAt: new Date(),
    });
    await PipelineJobEvent.create({
      uuid: randomUUID(),
      jobUuid: job.uuid,
      type: 'recovered',
      message,
    });
  }
  logger.info('Checked for stale pipeline jobs', { recovered: stale.length });
}
/**
 * Logs counts and oldest age for queued and running pipeline jobs.
 *
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function logQueueStatus(): Promise<void> {
  const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
  const counts = await Promise.all(
    statuses.map(
      async (status) => [status, await PipelineJob.count({ where: { status } })] as const,
    ),
  );
  logger.info('Pipeline queue status', {
    jobs: Object.fromEntries(counts),
    embeddingsEnabled: config.embeddings.enabled,
    pdfaEnabled: config.pdfa.enabled,
  });
}
/**
 * Writes a durable event describing a pipeline job state transition.
 *
 * @param {Transaction} transaction - Database transaction for related writes.
 * @param {string} jobUuid - UUID of the pipeline job.
 * @param {string} type - Event or value type being processed.
 * @param {string} message - Message to send or store as the failure reason.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function addEvent(
  transaction: Transaction,
  jobUuid: string,
  type: string,
  message: string,
): Promise<void> {
  await PipelineJobEvent.create(
    { uuid: randomUUID(), jobUuid, type, message: message.slice(0, 2000) },
    { transaction },
  );
}

/**
 * Records a user-visible document audit entry for an automated pipeline action.
 *
 * @param {Transaction} transaction - Database transaction for related writes.
 * @param {Pick<ClaimedJob, 'documentUuid' | 'ownerUuid' | 'kind'>} job - Claimed pipeline job being processed.
 * @param {| 'processing-started'
 * | 'processing-succeeded'
 * | 'processing-failed'
 * | 'archive-queued'
 * | 'archive-generated'
 * | 'archive-failed'
 * | 'quarantined'} eventType - Audit event type describing the processing transition.
 * @param {string} summary - Human-readable description of the event.
 * @param {Record<string, unknown>} details - Structured details to include in the event or audit record.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
async function addDocumentAudit(
  transaction: Transaction,
  job: Pick<ClaimedJob, 'documentUuid' | 'ownerUuid' | 'kind'>,
  eventType:
    | 'processing-started'
    | 'processing-succeeded'
    | 'processing-failed'
    | 'archive-queued'
    | 'archive-generated'
    | 'archive-failed'
    | 'quarantined',
  summary: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await DocumentAuditEvent.create(
    {
      uuid: randomUUID(),
      documentUuid: job.documentUuid,
      ownerUuid: job.ownerUuid,
      actorUuid: null,
      actorType: 'worker',
      eventType,
      summary: summary.slice(0, 500),
      details,
    },
    { transaction },
  );
}
/**
 * Waits between polling iterations while allowing shutdown to be requested.
 *
 * @param {number} milliseconds - Delay duration in milliseconds.
 * @returns {Promise<void>} - Resolves when the operation completes.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
