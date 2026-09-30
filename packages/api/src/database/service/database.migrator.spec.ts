import assert from 'node:assert/strict';
import { test } from 'node:test';
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
