import assert from 'node:assert/strict';
import test from 'node:test';
import { createGravatarUrl } from './gravatar';

test('creates a Gravatar URL from a normalized email address', () => {
  assert.equal(
    createGravatarUrl('  MyEmail@example.com '),
    'https://www.gravatar.com/avatar/60a6c20d49f49bc210ac98d7e47c74a0?d=404&s=96',
  );
});

test('does not create a Gravatar URL without an email address', () => {
  assert.equal(createGravatarUrl(null), null);
  assert.equal(createGravatarUrl('   '), null);
});
