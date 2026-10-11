import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { config } from './config.js';
import { extractPdfPages, requiresOcr, validatePdfBuffer } from './extraction.js';
import { createPdfFixture } from './pdf-test-fixture.js';
import { normalizeOcrSpacing } from './text-normalization.js';

let storageRoot: string;
let previousStorageRoot: string;

beforeEach(async () => {
  previousStorageRoot = config.storageRoot;
  storageRoot = await mkdtemp(join(tmpdir(), 'binder-worker-pdf-test-'));
  config.storageRoot = storageRoot;
});

afterEach(async () => {
  config.storageRoot = previousStorageRoot;
  await rm(storageRoot, { recursive: true, force: true });
});

describe('worker PDF extraction', () => {
  it('validates real PDFs and rejects bytes that only claim to be PDFs', async () => {
    await validatePdfBuffer(createPdfFixture(['Searchable page']));
    await assert.rejects(validatePdfBuffer(Buffer.from('not a PDF')), /valid PDF signature/);
    await assert.rejects(
      validatePdfBuffer(Buffer.from('%PDF-1.4\ninvalid objects')),
      /no objects found/i,
    );
  });

  it('extracts searchable text per page and marks a text PDF as not needing OCR', async () => {
    const storageKey = 'documents/2026/10/searchable.pdf';
    const sourcePath = join(storageRoot, storageKey);
    await mkdir(join(storageRoot, 'documents/2026/10'), { recursive: true });
    await writeFile(sourcePath, createPdfFixture(['Invoice 0101 2022', 'Second searchable page']));

    const result = await extractPdfPages(storageKey);

    assert.equal(result.pages.length, 2);
    assert.match(result.pages[0], /Invoice 0101 2022/);
    assert.match(result.pages[1], /Second searchable page/);
    assert.match(result.text, /Invoice 0101 2022/);
    assert.equal(result.requiresOcr, false);
  });

  it('marks a PDF with no usable text for OCR', async () => {
    const storageKey = 'documents/2026/10/scanned.pdf';
    await mkdir(join(storageRoot, 'documents/2026/10'), { recursive: true });
    await writeFile(join(storageRoot, storageKey), createPdfFixture(['', '']));

    const result = await extractPdfPages(storageKey);

    assert.deepEqual(result.pages, ['', '']);
    assert.equal(result.text, '');
    assert.equal(result.requiresOcr, true);
  });

  it('requests OCR for empty or corrupted text but keeps normal text searchable', () => {
    assert.equal(requiresOcr('  \n '), true);
    assert.equal(requiresOcr('Useful extracted text'), false);
    assert.equal(requiresOcr('abc\uFFFD\uFFFD\uFFFDxyz'), true);
    assert.equal(normalizeOcrSpacing('Datum: 0 1 . 0 1 . 2 0 2 2'), 'Datum: 01.01.2022');
  });
});
