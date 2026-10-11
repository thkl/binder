import assert from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    workerId: 'vitest-worker',
    ocrDeskew: false,
    embeddings: { enabled: false },
    pdfa: { enabled: false },
  },
  scanDocument: vi.fn(),
  extractPdfPages: vi.fn(),
  writeDerivedText: vi.fn(),
  persistPagesDestroy: vi.fn(),
  persistPagesBulkCreate: vi.fn(),
  matchDocumentIssuer: vi.fn(),
  runOcr: vi.fn(),
  embedDocument: vi.fn(),
  runPdfa: vi.fn(),
  createThumbnail: vi.fn(),
  documentUpdate: vi.fn(),
  pipelineJobUpdate: vi.fn(),
  pipelineJobFindOne: vi.fn(),
  pipelineJobCreate: vi.fn(),
  pipelineJobCount: vi.fn(),
  pipelineEventCreate: vi.fn(),
  documentAuditCreate: vi.fn(),
  inboxItemUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./config.js', () => ({ config: mocks.config }));
vi.mock('./database.js', () => ({
  sequelize: {
    transaction: mocks.transaction,
  },
}));
vi.mock('./models.js', () => ({
  Document: { update: mocks.documentUpdate },
  DocumentAuditEvent: { create: mocks.documentAuditCreate },
  InboxItem: { update: mocks.inboxItemUpdate },
  MaintenanceRequest: { findOne: vi.fn() },
  PipelineJob: {
    update: mocks.pipelineJobUpdate,
    findOne: mocks.pipelineJobFindOne,
    create: mocks.pipelineJobCreate,
    count: mocks.pipelineJobCount,
  },
  PipelineJobEvent: { create: mocks.pipelineEventCreate },
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./storage.js', () => ({
  createThumbnail: mocks.createThumbnail,
  migrateLegacyDerivedStorage: vi.fn(),
  writeDerivedText: mocks.writeDerivedText,
}));
vi.mock('./extraction.js', () => ({ extractPdfPages: mocks.extractPdfPages }));
vi.mock('./ocr.js', () => ({ runOcr: mocks.runOcr }));
vi.mock('./pdfa.js', () => ({ runPdfa: mocks.runPdfa }));
vi.mock('./embeddings.js', () => ({ embedDocument: mocks.embedDocument }));
vi.mock('./inbox-importer.js', () => ({ importInboxDocuments: vi.fn() }));
vi.mock('./email-importer.js', () => ({ importEmailMessages: vi.fn() }));
vi.mock('./issuer-matcher.js', () => ({ matchDocumentIssuer: mocks.matchDocumentIssuer }));
vi.mock('./malware-scanner.js', () => ({
  MalwareDetectedError: class MalwareDetectedError extends Error {},
  scanDocument: mocks.scanDocument,
}));
vi.mock('./recovery-state.js', () => ({
  isRecoveryActive: vi.fn(() => false),
  setRecoveryActive: vi.fn(),
}));
vi.mock('./document-page.model.js', () => ({
  DocumentPage: {
    destroy: mocks.persistPagesDestroy,
    bulkCreate: mocks.persistPagesBulkCreate,
  },
}));

import { processClaimedJob, type ClaimedJob } from './pipeline-worker.js';
import { MalwareDetectedError } from './malware-scanner.js';

const now = new Date('2026-10-11T12:00:00.000Z');

function job(kind: ClaimedJob['kind'], overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobUuid: 'job-1',
    documentUuid: 'document-1',
    ownerUuid: 'owner-1',
    kind,
    attempts: 1,
    maxAttempts: 3,
    storageKey: 'documents/2026/10/document-1.pdf',
    createdAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.ocrDeskew = false;
  mocks.config.embeddings.enabled = false;
  mocks.config.pdfa.enabled = false;
  mocks.transaction.mockImplementation(async (callback: (transaction: object) => unknown) =>
    callback({}),
  );
  mocks.documentUpdate.mockResolvedValue([1]);
  mocks.pipelineJobUpdate.mockResolvedValue([1]);
  mocks.pipelineJobFindOne.mockResolvedValue(null);
  mocks.pipelineJobCreate.mockImplementation(async (values: { uuid: string }) => values);
  mocks.pipelineJobCount.mockResolvedValue(0);
  mocks.pipelineEventCreate.mockResolvedValue(undefined);
  mocks.documentAuditCreate.mockResolvedValue(undefined);
  mocks.inboxItemUpdate.mockResolvedValue([0]);
  mocks.persistPagesDestroy.mockResolvedValue(undefined);
  mocks.persistPagesBulkCreate.mockResolvedValue(undefined);
});

describe('claimed document pipeline jobs', () => {
  it('persists searchable PDF pages and completes extraction', async () => {
    mocks.extractPdfPages.mockResolvedValue({
      pages: ['Invoice 2026', 'Payment due'],
      text: 'Invoice 2026\n\nPayment due',
      requiresOcr: false,
    });

    await processClaimedJob(job('text-extraction'));

    expect(mocks.extractPdfPages).toHaveBeenCalledWith('documents/2026/10/document-1.pdf');
    expect(mocks.writeDerivedText).toHaveBeenCalledWith(
      'document-1',
      'Invoice 2026\n\nPayment due',
      now,
    );
    expect(mocks.persistPagesBulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          documentUuid: 'document-1',
          pageNumber: 1,
          text: 'Invoice 2026',
        }),
        expect.objectContaining({ documentUuid: 'document-1', pageNumber: 2, text: 'Payment due' }),
      ]),
      expect.any(Object),
    );
    expect(mocks.matchDocumentIssuer).toHaveBeenCalledWith(
      'document-1',
      'owner-1',
      'Invoice 2026\n\nPayment due',
    );
    expect(mocks.pipelineJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
      expect.any(Object),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith({ status: 'ready' }, expect.any(Object));
  });

  it('queues OCR when a valid PDF has no usable text layer', async () => {
    mocks.extractPdfPages.mockResolvedValue({ pages: [], text: '', requiresOcr: true });

    await processClaimedJob(job('text-extraction'));

    expect(mocks.writeDerivedText).toHaveBeenCalledWith('document-1', '', now);
    expect(mocks.persistPagesBulkCreate).not.toHaveBeenCalled();
    expect(mocks.pipelineJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ocr', status: 'queued', documentUuid: 'document-1' }),
      expect.any(Object),
    );
    expect(mocks.documentUpdate).not.toHaveBeenCalledWith({ status: 'ready' }, expect.any(Object));
  });

  it('creates the thumbnail through the PDF handler and marks that job complete', async () => {
    await processClaimedJob(job('thumbnail'));

    expect(mocks.createThumbnail).toHaveBeenCalledWith(
      'documents/2026/10/document-1.pdf',
      'document-1',
      now,
    );
    expect(mocks.pipelineJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
      expect.any(Object),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith({ status: 'ready' }, expect.any(Object));
  });

  it('runs OCR, extracts its searchable text, and persists page boundaries', async () => {
    mocks.runOcr.mockResolvedValue('derived/2026/10/document-1/ocr.pdf');
    mocks.extractPdfPages.mockResolvedValue({
      pages: ['Recognized text'],
      text: 'Recognized text',
      requiresOcr: false,
    });

    await processClaimedJob(job('ocr'));

    expect(mocks.runOcr).toHaveBeenCalledWith(
      'documents/2026/10/document-1.pdf',
      'document-1',
      now,
      {},
    );
    expect(mocks.extractPdfPages).toHaveBeenCalledWith('derived/2026/10/document-1/ocr.pdf');
    expect(mocks.writeDerivedText).toHaveBeenCalledWith('document-1', 'Recognized text', now);
    expect(mocks.matchDocumentIssuer).toHaveBeenCalledWith(
      'document-1',
      'owner-1',
      'Recognized text',
    );
  });

  it('forces OCR immediately for a broken text layer when deskew is enabled', async () => {
    mocks.config.ocrDeskew = true;
    mocks.extractPdfPages
      .mockResolvedValueOnce({ pages: ['Bad � text'], text: 'Bad � text', requiresOcr: true })
      .mockResolvedValueOnce({
        pages: ['Repaired text'],
        text: 'Repaired text',
        requiresOcr: false,
      });
    mocks.runOcr.mockResolvedValue('derived/2026/10/document-1/ocr.pdf');

    await processClaimedJob(job('ocr'));

    expect(mocks.runOcr).toHaveBeenCalledWith(
      'documents/2026/10/document-1.pdf',
      'document-1',
      now,
      { forceOcr: true },
    );
    expect(mocks.writeDerivedText).toHaveBeenCalledWith('document-1', 'Repaired text', now);
  });

  it('queues optional embedding and PDF/A work after searchable extraction', async () => {
    mocks.config.embeddings.enabled = true;
    mocks.config.pdfa.enabled = true;
    mocks.extractPdfPages.mockResolvedValue({
      pages: ['Invoice text'],
      text: 'Invoice text',
      requiresOcr: false,
    });

    await processClaimedJob(job('text-extraction'));

    expect(mocks.embedDocument).not.toHaveBeenCalled();
    expect(mocks.pipelineJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'embedding', status: 'queued' }),
      expect.any(Object),
    );
    expect(mocks.pipelineJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pdfa', status: 'queued' }),
      expect.any(Object),
    );
  });

  it('stores the generated PDF/A archive and completes its processing state', async () => {
    mocks.runPdfa.mockResolvedValue('derived/2026/10/document-1/archive.pdf');

    await processClaimedJob(job('pdfa'));

    expect(mocks.runPdfa).toHaveBeenCalledWith(
      'documents/2026/10/document-1.pdf',
      'document-1',
      now,
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith(
      {
        archiveKey: 'derived/2026/10/document-1/archive.pdf',
        archiveStatus: 'ready',
        archiveError: null,
      },
      expect.any(Object),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith({ status: 'ready' }, expect.any(Object));
  });

  it('queues extraction only after the malware scan succeeds', async () => {
    await processClaimedJob(job('malware-scan'));

    expect(mocks.scanDocument).toHaveBeenCalledWith(
      'documents/2026/10/document-1.pdf',
      'document-1',
    );
    expect(mocks.extractPdfPages).not.toHaveBeenCalled();
    expect(mocks.pipelineJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text-extraction', status: 'queued' }),
      expect.any(Object),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith({ status: 'processing' }, expect.any(Object));
  });

  it('quarantines malware-positive PDFs and does not start extraction', async () => {
    mocks.scanDocument.mockRejectedValue(new MalwareDetectedError('Threat found'));

    await processClaimedJob(job('malware-scan'));

    expect(mocks.documentUpdate).toHaveBeenCalledWith(
      { status: 'quarantined' },
      expect.any(Object),
    );
    expect(mocks.pipelineJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', lastError: 'Threat found' }),
      expect.any(Object),
    );
    expect(mocks.extractPdfPages).not.toHaveBeenCalled();
  });

  it('schedules a retry when PDF extraction fails before the retry limit', async () => {
    mocks.extractPdfPages.mockRejectedValue(new Error('PDF parser failed'));

    await processClaimedJob(job('text-extraction', { attempts: 2, maxAttempts: 3 }));

    expect(mocks.pipelineJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', lastError: 'PDF parser failed' }),
      expect.any(Object),
    );
    expect(mocks.pipelineEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'retry-scheduled' }),
      expect.any(Object),
    );
    assert.equal(mocks.pipelineJobUpdate.mock.calls.length, 1);
  });

  it('marks a job failed when PDF processing exhausts its retry limit', async () => {
    mocks.extractPdfPages.mockRejectedValue(new Error('PDF parser failed permanently'));

    await processClaimedJob(job('text-extraction', { attempts: 3, maxAttempts: 3 }));

    expect(mocks.pipelineJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', lastError: 'PDF parser failed permanently' }),
      expect.any(Object),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith({ status: 'failed' }, expect.any(Object));
  });
});
