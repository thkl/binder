import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from './document.service.js';
import { DocumentStorageService } from './document-storage.service.js';
import { DocumentFormatRegistry } from './document-format.registry.js';
import { PdfDocumentFormatAdapter } from './pdf-document-format.adapter.js';
import { ImageDocumentFormatAdapter } from './image-document-format.adapter.js';
import { ConfigKeys } from '../../../shared/config/config.keys.js';
import { createPdfFixture } from './pdf-test-fixture.js';

const temporaryDirectories: string[] = [];
const ownerUuid = '11111111-1111-4111-8111-111111111111';

async function createFixture(
  options: {
    malwareScanRequired?: string;
    duplicateOwnerUuid?: string;
    maxUploadBytes?: string;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'binder-api-document-service-test-'));
  temporaryDirectories.push(root);
  const inputPath = join(root, 'input.pdf');
  await writeFile(inputPath, createPdfFixture(['Invoice 2026']));

  const storage = new DocumentStorageService(
    {
      get: (key: string) => (key === ConfigKeys.DOCUMENT_STORAGE_ROOT ? root : undefined),
    } as never,
    { get: async () => options.maxUploadBytes ?? '52428800' } as never,
  );
  const removeStoredFile = vi.spyOn(storage, 'remove');
  const created: Array<Record<string, unknown>> = [];
  const documents = {
    findByChecksum: vi.fn(async () =>
      options.duplicateOwnerUuid
        ? { uuid: 'duplicate-document', ownerUuid: options.duplicateOwnerUuid }
        : null,
    ),
    create: vi.fn(async (document: Record<string, unknown>) => {
      created.push(document);
      const now = new Date('2026-10-11T10:00:00.000Z');
      return {
        archiveKey: null,
        archiveStatus: 'not-requested',
        archiveError: null,
        aiSuggestion: null,
        createdAt: now,
        updatedAt: now,
        ...document,
      };
    }),
  };
  const pipeline = {
    enqueue: vi.fn(async (_documentUuid: string, _ownerUuid: string, _kind: string) => undefined),
  };
  const inboxItems = { create: vi.fn(async (item: unknown) => item) };
  const audit = { record: vi.fn(async () => undefined) };
  const eventEmitter = { emit: vi.fn() };
  const settings = {
    get: async (key: string, fallback: string) =>
      key === 'security.malwareScan.required'
        ? (options.malwareScanRequired ?? fallback)
        : fallback,
  };

  const service = new DocumentService(
    {} as never,
    documents as never,
    storage,
    new DocumentFormatRegistry(
      new PdfDocumentFormatAdapter(storage),
      new ImageDocumentFormatAdapter(storage),
    ),
    pipeline as never,
    {} as never,
    {} as never,
    {} as never,
    { get: () => 'api/v1' } as never,
    {} as never,
    {} as never,
    inboxItems as never,
    eventEmitter as never,
    audit as never,
    {} as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    root,
    inputPath,
    service,
    storage,
    removeStoredFile,
    documents,
    pipeline,
    inboxItems,
    audit,
    created,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('document upload service', () => {
  it('detects PDF bytes despite misleading MIME and extension hints, then stores canonical PDF metadata', async () => {
    const fixture = await createFixture();
    const originalBytes = await readFile(fixture.inputPath);

    const response = await fixture.service.upload(ownerUuid, {
      path: fixture.inputPath,
      size: originalBytes.length,
      mimetype: 'image/png',
      originalname: 'invoice.png',
    });

    assert.equal(response.mimeType, 'application/pdf');
    assert.equal(response.status, 'scanning');
    assert.equal(fixture.created[0]?.['ownerUuid'], ownerUuid);
    assert.equal(fixture.created[0]?.['originalFilename'], 'invoice.png');
    assert.match(String(fixture.created[0]?.['storageKey']), /\.pdf$/u);
    assert.equal(fixture.pipeline.enqueue.mock.calls[0]?.[2], 'malware-scan');
    assert.equal(await fixture.storage.exists(String(fixture.created[0]?.['storageKey'])), true);
    assert.deepEqual(await readFile(fixture.inputPath), originalBytes);
    expect(fixture.inboxItems.create).toHaveBeenCalledOnce();
    expect(fixture.audit.record).toHaveBeenCalledOnce();
  });

  it('detects and stores a real PNG from its bytes despite a misleading PDF filename', async () => {
    const fixture = await createFixture();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7XcAAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(fixture.inputPath, png);

    const response = await fixture.service.upload(ownerUuid, {
      path: fixture.inputPath,
      size: png.length,
      mimetype: 'application/pdf',
      originalname: 'invoice.pdf',
    });

    assert.equal(response.mimeType, 'image/png');
    assert.equal(fixture.created[0]?.['originalFilename'], 'invoice.pdf');
    assert.match(String(fixture.created[0]?.['storageKey']), /\.png$/u);
    assert.equal(fixture.created[0]?.['pageCount'], 1);
    assert.equal(await fixture.storage.exists(String(fixture.created[0]?.['storageKey'])), true);
  });

  it('rejects non-PDF bytes even when the MIME type and extension claim PDF', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.inputPath, Buffer.from('renamed executable payload'));

    await assert.rejects(
      fixture.service.upload(ownerUuid, {
        path: fixture.inputPath,
        size: 27,
        mimetype: 'application/pdf',
        originalname: 'looks-like-a-pdf.pdf',
      }),
      /format is not supported/,
    );

    expect(fixture.documents.create).not.toHaveBeenCalled();
    expect(fixture.pipeline.enqueue).not.toHaveBeenCalled();
  });

  it('rejects malformed content with a PDF signature before creating a document record', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.inputPath, Buffer.from('%PDF-1.7\nnot a valid PDF object tree'));

    await assert.rejects(
      fixture.service.upload(ownerUuid, {
        path: fixture.inputPath,
        size: 37,
        mimetype: 'application/pdf',
        originalname: 'malformed.pdf',
      }),
      /not a valid PDF/,
    );

    expect(fixture.documents.create).not.toHaveBeenCalled();
    expect(fixture.pipeline.enqueue).not.toHaveBeenCalled();
  });

  it('rejects empty and over-limit files before the PDF parser runs', async () => {
    const emptyFixture = await createFixture();
    await writeFile(emptyFixture.inputPath, Buffer.alloc(0));
    const validateEmptyPdf = vi.spyOn(emptyFixture.storage, 'validatePdf');

    await assert.rejects(
      emptyFixture.service.upload(ownerUuid, {
        path: emptyFixture.inputPath,
        size: 0,
        mimetype: 'application/pdf',
        originalname: 'empty.pdf',
      }),
      /document is empty/,
    );
    expect(validateEmptyPdf).not.toHaveBeenCalled();
    expect(emptyFixture.documents.create).not.toHaveBeenCalled();

    const oversizedFixture = await createFixture({ maxUploadBytes: '10' });
    const validateLargePdf = vi.spyOn(oversizedFixture.storage, 'validatePdf');
    const pdfBytes = await readFile(oversizedFixture.inputPath);

    await assert.rejects(
      oversizedFixture.service.upload(ownerUuid, {
        path: oversizedFixture.inputPath,
        size: pdfBytes.length,
        mimetype: 'application/pdf',
        originalname: 'too-large.pdf',
      }),
      /maximum size of 10 bytes/,
    );
    expect(validateLargePdf).not.toHaveBeenCalled();
    expect(oversizedFixture.documents.create).not.toHaveBeenCalled();
    expect(oversizedFixture.pipeline.enqueue).not.toHaveBeenCalled();
  });

  it('starts text extraction directly when malware scanning is explicitly disabled', async () => {
    const fixture = await createFixture({ malwareScanRequired: 'false' });
    const stat = await readFile(fixture.inputPath);

    const response = await fixture.service.upload(ownerUuid, {
      path: fixture.inputPath,
      size: stat.length,
      mimetype: 'application/pdf',
      originalname: 'invoice.pdf',
    });

    assert.equal(response.status, 'processing');
    assert.equal(fixture.pipeline.enqueue.mock.calls[0]?.[2], 'text-extraction');
  });

  it('removes the stored duplicate and only reveals its UUID to the same owner', async () => {
    const fixture = await createFixture({ duplicateOwnerUuid: ownerUuid });
    const contents = await readFile(fixture.inputPath);
    let conflict: unknown;

    try {
      await fixture.service.upload(ownerUuid, {
        path: fixture.inputPath,
        size: contents.length,
        mimetype: 'application/pdf',
        originalname: 'duplicate.pdf',
      });
    } catch (error) {
      conflict = error;
    }

    assert.ok(conflict instanceof ConflictException);
    assert.equal(
      (conflict.getResponse() as { documentUuid?: string }).documentUuid,
      'duplicate-document',
    );
    assert.equal(fixture.documents.create.mock.calls.length, 0);
    expect(fixture.removeStoredFile).toHaveBeenCalledOnce();
    const removedStorageKey = String(fixture.removeStoredFile.mock.calls[0]?.[0]);
    assert.equal(await fixture.storage.exists(removedStorageKey), false);
    assert.equal(contents.length > 0, true);
  });

  it('does not reveal another owner’s duplicate document UUID', async () => {
    const fixture = await createFixture({
      duplicateOwnerUuid: '33333333-3333-4333-8333-333333333333',
    });
    const contents = await readFile(fixture.inputPath);

    await assert.rejects(
      fixture.service.upload(ownerUuid, {
        path: fixture.inputPath,
        size: contents.length,
        mimetype: 'application/pdf',
        originalname: 'duplicate.pdf',
      }),
      (error: unknown) => {
        if (!(error instanceof ConflictException)) return false;
        return !('documentUuid' in (error.getResponse() as Record<string, unknown>));
      },
    );
  });
});
