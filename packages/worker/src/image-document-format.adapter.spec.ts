import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { config } from './config.js';
import { ImageDocumentFormatAdapter } from './image-document-format.adapter.js';

const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7XcAAAAASUVORK5CYII=',
  'base64',
);
let storageRoot: string;
let originalStorageRoot: string;

beforeEach(async () => {
  originalStorageRoot = config.storageRoot;
  storageRoot = await mkdtemp(join(tmpdir(), 'binder-worker-image-test-'));
  config.storageRoot = storageRoot;
});

afterEach(async () => {
  config.storageRoot = originalStorageRoot;
  await rm(storageRoot, { recursive: true, force: true });
});

describe('image document format adapter', () => {
  it('validates PNG bytes and reports that OCR is required', async () => {
    const adapter = new ImageDocumentFormatAdapter();
    await adapter.validate(pngFixture, 'image/png');
    await assert.rejects(adapter.validate(Buffer.from('not PNG'), 'image/png'), /does not match/);
    assert.deepEqual(await adapter.extractText('unused.png'), {
      segments: [],
      pageCount: 1,
      text: '',
      requiresOcr: true,
    });
  });

  it('returns one searchable segment from Tesseract output', async () => {
    const adapter = new ImageDocumentFormatAdapter();
    const imagePath = join(storageRoot, 'source.png');
    const bin = join(storageRoot, 'bin');
    const previousPath = process.env['PATH'];
    await mkdir(bin, { recursive: true });
    await writeFile(imagePath, pngFixture);
    await writeFile(join(bin, 'tesseract'), '#!/bin/sh\nprintf "  Extracted from image  \\n"\n');
    await chmod(join(bin, 'tesseract'), 0o700);
    process.env['PATH'] = `${bin}:${previousPath ?? ''}`;

    try {
      const result = await adapter.runOcr('source.png', 'image-document', new Date());
      assert.deepEqual(result, {
        segments: [{ segmentIndex: 1, pageNumber: 1, text: 'Extracted from image' }],
        pageCount: 1,
        text: 'Extracted from image',
        requiresOcr: false,
      });
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });
});
