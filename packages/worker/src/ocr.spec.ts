import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, test } from 'vitest';
import { config } from './config.js';
import { buildOcrArguments, runOcr } from './ocr.js';
import { createPdfFixture } from './pdf-test-fixture.js';

test('limits OCRmyPDF parallelism and redoes existing OCR text by default', () => {
  const previous = {
    ocrJobs: config.ocrJobs,
    ocrLanguages: config.ocrLanguages,
    ocrRotatePages: config.ocrRotatePages,
    ocrDeskew: config.ocrDeskew,
  };

  try {
    config.ocrJobs = 1;
    config.ocrLanguages = 'deu+eng';
    config.ocrRotatePages = true;
    config.ocrDeskew = false;

    assert.deepEqual(buildOcrArguments('/input.pdf', '/output.pdf'), [
      '--jobs',
      '1',
      '--redo-ocr',
      '--rotate-pages',
      '--language',
      'deu+eng',
      '--output-type',
      'pdf',
      '/input.pdf',
      '/output.pdf',
    ]);
  } finally {
    config.ocrJobs = previous.ocrJobs;
    config.ocrLanguages = previous.ocrLanguages;
    config.ocrRotatePages = previous.ocrRotatePages;
    config.ocrDeskew = previous.ocrDeskew;
  }
});

test('supports a forced OCR fallback for unusable existing text layers', () => {
  const previous = {
    ocrJobs: config.ocrJobs,
    ocrLanguages: config.ocrLanguages,
    ocrRotatePages: config.ocrRotatePages,
    ocrDeskew: config.ocrDeskew,
  };

  try {
    config.ocrJobs = 1;
    config.ocrLanguages = 'eng';
    config.ocrRotatePages = false;
    config.ocrDeskew = false;

    assert.deepEqual(buildOcrArguments('/input.pdf', '/output.pdf', { forceOcr: true }), [
      '--jobs',
      '1',
      '--force-ocr',
      '--language',
      'eng',
      '--output-type',
      'pdf',
      '/input.pdf',
      '/output.pdf',
    ]);
  } finally {
    config.ocrJobs = previous.ocrJobs;
    config.ocrLanguages = previous.ocrLanguages;
    config.ocrRotatePages = previous.ocrRotatePages;
    config.ocrDeskew = previous.ocrDeskew;
  }
});

test('uses skip-text with deskew to avoid rasterizing pages that already have text', () => {
  const previous = {
    ocrJobs: config.ocrJobs,
    ocrLanguages: config.ocrLanguages,
    ocrRotatePages: config.ocrRotatePages,
    ocrDeskew: config.ocrDeskew,
  };

  try {
    config.ocrJobs = 2;
    config.ocrLanguages = 'eng';
    config.ocrRotatePages = false;
    config.ocrDeskew = true;

    assert.deepEqual(buildOcrArguments('/input.pdf', '/output.pdf'), [
      '--jobs',
      '2',
      '--skip-text',
      '--deskew',
      '--language',
      'eng',
      '--output-type',
      'pdf',
      '/input.pdf',
      '/output.pdf',
    ]);
  } finally {
    config.ocrJobs = previous.ocrJobs;
    config.ocrLanguages = previous.ocrLanguages;
    config.ocrRotatePages = previous.ocrRotatePages;
    config.ocrDeskew = previous.ocrDeskew;
  }
});

describe('OCR artifact handling', () => {
  it('installs successful OCR output atomically at the derived PDF path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binder-ocr-test-'));
    const previousRoot = config.storageRoot;
    const previousPath = process.env['PATH'];
    const bin = join(root, 'bin');
    const sourceKey = 'documents/source.pdf';
    const source = createPdfFixture(['OCR input']);
    const createdAt = new Date('2026-10-11T12:00:00.000Z');
    const documentUuid = 'ocr-document';

    try {
      config.storageRoot = root;
      await mkdir(bin, { recursive: true });
      await mkdir(join(root, 'documents'), { recursive: true });
      await writeFile(join(root, sourceKey), source);
      await writeFile(
        join(bin, 'ocrmypdf'),
        '#!/bin/sh\nfor arg do previous="$last"; last="$arg"; done\ncp "$previous" "$last"\n',
      );
      await chmod(join(bin, 'ocrmypdf'), 0o700);
      process.env['PATH'] = `${bin}:${previousPath ?? ''}`;

      const outputKey = await runOcr(sourceKey, documentUuid, createdAt);

      assert.equal(outputKey, 'derived/2026/10/ocr-document/ocr.pdf');
      assert.deepEqual(await readFile(join(root, outputKey)), source);
      assert.deepEqual(await readdir(join(root, 'derived/2026/10/ocr-document')), ['ocr.pdf']);
    } finally {
      config.storageRoot = previousRoot;
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes temporary OCR output when the processing tool fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binder-ocr-failure-test-'));
    const previousRoot = config.storageRoot;
    const previousPath = process.env['PATH'];
    const bin = join(root, 'bin');
    const sourceKey = 'documents/source.pdf';
    const createdAt = new Date('2026-10-11T12:00:00.000Z');
    const outputDirectory = join(root, 'derived/2026/10/failed-ocr');

    try {
      config.storageRoot = root;
      await mkdir(bin, { recursive: true });
      await mkdir(join(root, 'documents'), { recursive: true });
      await writeFile(join(root, sourceKey), createPdfFixture(['OCR input']));
      await writeFile(join(bin, 'ocrmypdf'), '#!/bin/sh\necho simulated failure >&2\nexit 2\n');
      await chmod(join(bin, 'ocrmypdf'), 0o700);
      process.env['PATH'] = `${bin}:${previousPath ?? ''}`;

      await assert.rejects(
        runOcr(sourceKey, 'failed-ocr', createdAt),
        /ocrmypdf failed: simulated failure/,
      );
      assert.deepEqual(await readdir(outputDirectory), []);
    } finally {
      config.storageRoot = previousRoot;
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });
});
