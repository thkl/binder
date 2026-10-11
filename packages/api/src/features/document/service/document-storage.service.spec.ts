import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, it } from 'vitest';
import { ConfigKeys } from '../../../shared/config/config.keys.js';
import { DocumentStorageService } from './document-storage.service.js';
import { createPdfFixture } from './pdf-test-fixture.js';

const temporaryDirectories: string[] = [];

async function storage(maxBytes = 1024 * 1024): Promise<DocumentStorageService> {
  const root = await mkdtemp(join(tmpdir(), 'binder-api-pdf-test-'));
  temporaryDirectories.push(root);
  return new DocumentStorageService(
    {
      get: (key: string) => (key === ConfigKeys.DOCUMENT_STORAGE_ROOT ? root : undefined),
    } as never,
    { get: async () => String(maxBytes) } as never,
  );
}

async function pageCount(buffer: Buffer): Promise<number> {
  const mupdf = await import('mupdf');
  const document = new mupdf.PDFDocument(buffer);
  try {
    return document.countPages();
  } finally {
    document.destroy();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('document PDF storage', () => {
  it('validates and stores JPEG/PNG images with bounded dimensions', async () => {
    const service = await storage();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7XcAAAAASUVORK5CYII=',
      'base64',
    );
    await service.validateImage(png, 'image/png');
    const saved = await service.storeImage(png, 'image-document', '.png');
    assert.match(saved.storageKey, /image-document\.png$/u);
    assert.deepEqual(await readFile(saved.absolutePath), png);
    const thumbnailKey = await service.createImageThumbnail(
      saved.storageKey,
      'image-document',
      new Date('2026-10-11T12:00:00Z'),
      'image/png',
    );
    assert.equal(await service.exists(thumbnailKey), true);
    await assert.rejects(service.validateImage(Buffer.from('not an image'), 'image/png'), /valid JPEG or PNG/);
  });

  it('validates a readable PDF and rejects invalid signatures or malformed files', async () => {
    const service = await storage();
    await service.validatePdf(createPdfFixture(['Invoice 2026']));

    await assert.rejects(
      service.validatePdf(Buffer.from('not a PDF')),
      (error: unknown) =>
        error instanceof BadRequestException && /valid PDF signature/.test(error.message),
    );
    await assert.rejects(
      service.validatePdf(Buffer.from('%PDF-1.4\nthis is not a valid PDF object tree')),
      (error: unknown) =>
        error instanceof BadRequestException && /not a valid PDF/.test(error.message),
    );
  });

  it('stores an immutable source with a stable key, size, and SHA-256 checksum', async () => {
    const service = await storage();
    const pdf = createPdfFixture(['Original PDF']);
    const saved = await service.storePdf(pdf, 'document-uuid', 'statement.pdf');

    assert.match(saved.storageKey, /^documents\/\d{4}\/\d{2}\/document-uuid\.pdf$/);
    assert.equal(saved.sizeBytes, pdf.length);
    assert.equal(saved.checksumSha256, createHash('sha256').update(pdf).digest('hex'));
    assert.deepEqual(await readFile(saved.absolutePath), pdf);
    assert.equal(await service.exists(saved.storageKey), true);
  });

  it('rejects empty and over-limit uploads before storing them', async () => {
    const service = await storage(16);

    await assert.rejects(service.storePdf(Buffer.alloc(0), 'empty', 'empty.pdf'), /empty/);
    await assert.rejects(
      service.storePdf(createPdfFixture(['larger than limit']), 'large', 'large.pdf'),
      (error: unknown) =>
        error instanceof BadRequestException && /maximum size/.test(error.message),
    );
  });

  it('rejects storage keys that escape the configured root', async () => {
    const service = await storage();
    await assert.rejects(
      service.resolveStoragePath('../outside.pdf'),
      (error: unknown) =>
        error instanceof BadRequestException && /Invalid document storage path/.test(error.message),
    );
  });

  it('splits pages without losing either side and rejects empty splits', async () => {
    const service = await storage();
    const source = await service.storePdf(
      createPdfFixture(['Page one', 'Page two', 'Page three']),
      'source',
      'source.pdf',
    );

    const [first, second] = await service.splitPdf(source.storageKey, 1);
    assert.deepEqual(await Promise.all([pageCount(first), pageCount(second)]), [1, 2]);
    await assert.rejects(service.splitPdf(source.storageKey, 0), /leave at least one page/);
    await assert.rejects(service.splitPdf(source.storageKey, 3), /leave at least one page/);
    assert.deepEqual(
      await readFile(source.absolutePath),
      createPdfFixture(['Page one', 'Page two', 'Page three']),
    );
  });

  it('rotates a valid page and rejects page numbers outside the PDF', async () => {
    const service = await storage();
    const source = await service.storePdf(createPdfFixture(['Rotate me']), 'rotate', 'rotate.pdf');

    const rotated = await service.rotatePdfPage(source.storageKey, 1, 180);
    await service.validatePdf(rotated);
    assert.equal(await pageCount(rotated), 1);
    await assert.rejects(
      service.rotatePdfPage(source.storageKey, 0, 90),
      /page number must be between/,
    );
    await assert.rejects(
      service.rotatePdfPage(source.storageKey, 2, 90),
      /page number must be between/,
    );
  });

  it('composes PDFs at each valid insertion boundary and rejects invalid positions', async () => {
    const service = await storage();
    const target = await service.storePdf(
      createPdfFixture(['Target one', 'Target two']),
      'target',
      'target.pdf',
    );
    const source = await service.storePdf(
      createPdfFixture(['Inserted']),
      'inserted',
      'inserted.pdf',
    );

    const composed = await service.composePdf(target.storageKey, source.storageKey, 1);
    assert.equal(composed.pageCount, 3);
    assert.equal(await pageCount(composed.buffer), 3);
    assert.equal((await service.composePdf(target.storageKey, source.storageKey, 0)).pageCount, 3);
    assert.equal((await service.composePdf(target.storageKey, source.storageKey, 2)).pageCount, 3);
    await assert.rejects(
      service.composePdf(target.storageKey, source.storageKey, 3),
      /insertion point/,
    );
  });

  it('creates a PNG thumbnail from the first page', async () => {
    const service = await storage();
    const source = await service.storePdf(
      createPdfFixture(['Preview me', 'Second page']),
      'preview',
      'preview.pdf',
    );

    const thumbnailKey = await service.createThumbnail(
      source.storageKey,
      'preview',
      new Date('2026-01-15T12:00:00.000Z'),
    );
    const thumbnailPath = await service.resolveStoragePath(thumbnailKey);
    const png = await readFile(thumbnailPath);

    assert.equal(thumbnailKey, 'derived/2026/01/preview/thumbnail.png');
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
