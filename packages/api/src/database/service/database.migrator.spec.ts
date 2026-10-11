import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { DatabaseMigrator } from './database.migrator';

function isSafeMigration(sql: string): boolean {
  const migrator = Object.create(DatabaseMigrator.prototype) as DatabaseMigrator;
  return (
    migrator as unknown as { checkSafeInstructions: (value: string) => boolean }
  ).checkSafeInstructions(sql);
}

test('allows replacing a named table constraint inside a migration', () => {
  assert.equal(
    isSafeMigration(`
      ALTER TABLE documents
        DROP CONSTRAINT IF EXISTS documents_status_check;
      ALTER TABLE documents
        ADD CONSTRAINT documents_status_check
        CHECK (status IN ('uploaded', 'quarantined'));
    `),
    true,
  );
});

test('continues to reject destructive table operations', () => {
  assert.equal(isSafeMigration('DROP TABLE documents;'), false);
  assert.equal(isSafeMigration('DELETE FROM documents;'), false);
});

test('allows only explicit column nullability changes for page-independent references', () => {
  assert.equal(
    isSafeMigration(
      'ALTER TABLE document_pages ALTER COLUMN page_number DROP NOT NULL; ALTER TABLE document_pages ALTER COLUMN segment_index SET NOT NULL;',
    ),
    true,
  );
  assert.equal(isSafeMigration('ALTER TABLE documents ALTER COLUMN page_count TYPE TEXT;'), false);
  assert.equal(isSafeMigration('ALTER TABLE documents DROP COLUMN page_count;'), false);
});

test('accepts the segment migration and includes legacy page-number backfills', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'migrations/V075__support_unpaged_extraction_segments.sql'),
    'utf8',
  );

  assert.equal(isSafeMigration(migration), true);
  assert.match(migration, /UPDATE document_pages SET segment_index = page_number/);
  assert.match(migration, /UPDATE document_embeddings SET segment_index = page_number/);
});
