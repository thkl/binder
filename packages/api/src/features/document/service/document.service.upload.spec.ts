import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from './document.service.js';
import { DocumentStorageService } from './document-storage.service.js';
import { ConfigKeys } from '../../../shared/config/config.keys.js';
import { createPdfFixture } from './pdf-test-fixture.js';

const temporaryDirectories: string[] = [];
const ownerUuid = '11111111-1111-4111-8111-111111111111';

async function createFixture(
  options: { malwareScanRequired?: string; duplicateOwnerUuid?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'binder-api-document-service-test-'));
  temporaryDirectories.push(root);
  const inputPath = join(root, 'input.pdf');
  await writeFile(inputPath, createPdfFixture(['Invoice 2026']));

  const storage = new DocumentStorageService(
    {
      get: (key: string) => (key === ConfigKeys.DOCUMENT_STORAGE_ROOT ? root : undefined),
    } as never,
    { get: async () => '52428800' } as never,
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
  it('validates the actual PDF bytes, preserves the original, and queues the malware scan first', async () => {
    const fixture = await createFixture();
    const originalBytes = await readFile(fixture.inputPath);

    const response = await fixture.service.upload(ownerUuid, {
      path: fixture.inputPath,
      size: originalBytes.length,
      mimetype: 'application/octet-stream',
      originalname: 'invoice.pdf',
    });

    assert.equal(response.mimeType, 'application/pdf');
    assert.equal(response.status, 'scanning');
    assert.equal(fixture.created[0]?.['ownerUuid'], ownerUuid);
    assert.equal(fixture.created[0]?.['originalFilename'], 'invoice.pdf');
    assert.equal(fixture.pipeline.enqueue.mock.calls[0]?.[2], 'malware-scan');
    assert.equal(await fixture.storage.exists(String(fixture.created[0]?.['storageKey'])), true);
    assert.deepEqual(await readFile(fixture.inputPath), originalBytes);
    expect(fixture.inboxItems.create).toHaveBeenCalledOnce();
    expect(fixture.audit.record).toHaveBeenCalledOnce();
  });

  it('rejects content that is not a PDF before creating a document record', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.inputPath, Buffer.from('renamed executable payload'));

    await assert.rejects(
      fixture.service.upload(ownerUuid, {
        path: fixture.inputPath,
        size: 27,
        mimetype: 'application/pdf',
        originalname: 'looks-like-a-pdf.pdf',
      }),
      /valid PDF signature/,
    );

    expect(fixture.documents.create).not.toHaveBeenCalled();
    expect(fixture.pipeline.enqueue).not.toHaveBeenCalled();
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
