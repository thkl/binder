import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { config } from './config.js';
import {
  derivedDirectory,
  resolveStoragePath,
  storageExists,
  writeDerivedText,
} from './storage.js';

let storageRoot: string;
let previousStorageRoot: string;

beforeEach(async () => {
  previousStorageRoot = config.storageRoot;
  storageRoot = await mkdtemp(join(tmpdir(), 'binder-worker-storage-test-'));
  config.storageRoot = storageRoot;
});

afterEach(async () => {
  config.storageRoot = previousStorageRoot;
  await rm(storageRoot, { recursive: true, force: true });
});

describe('worker derived storage', () => {
  it('keeps derived artifacts under the date-partitioned document directory', () => {
    assert.equal(
      derivedDirectory('document-uuid', new Date('2026-10-04T23:59:00.000Z')),
      'derived/2026/10/document-uuid',
    );
  });

  it('rejects absolute and relative paths that escape the storage root', () => {
    assert.throws(() => resolveStoragePath('../outside.pdf'), /Invalid document storage path/);
    assert.throws(() => resolveStoragePath('/etc/passwd'), /Invalid document storage path/);
  });

  it('atomically writes derived text and reports whether storage keys exist', async () => {
    const uuid = 'document-uuid';
    const createdAt = new Date('2026-10-04T23:59:00.000Z');
    const key = `${derivedDirectory(uuid, createdAt)}/extracted.txt`;

    assert.equal(await storageExists(key), false);
    await writeDerivedText(uuid, 'Extracted page text\nSecond line', createdAt);

    assert.equal(await storageExists(key), true);
    assert.equal(
      await readFile(resolveStoragePath(key), 'utf8'),
      'Extracted page text\nSecond line',
    );
  });
});
