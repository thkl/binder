import assert from 'node:assert/strict';
import test from 'node:test';
import type { VocabularyItem } from '@binder/common';
import { preferPersonalVocabulary } from './vocabulary-precedence';

const ownerUuid = '552c58a1-1f01-4db8-97ab-a476b1cc816b';
const workspaceType = createVocabularyItem({
  uuid: '11111111-1111-4111-8111-111111111111',
  ownerUuid: null,
  name: 'Invoice',
});
const personalType = createVocabularyItem({
  uuid: '22222222-2222-4222-8222-222222222222',
  ownerUuid,
  name: 'invoice',
  folderUuid: '33333333-3333-4333-8333-333333333333',
});

test('personal vocabulary wins when workspace vocabulary is returned first', () => {
  const result = preferPersonalVocabulary([workspaceType, personalType], ownerUuid);

  assert.deepEqual(
    result.map((item) => item.uuid),
    [personalType.uuid],
  );
  assert.equal(result[0]?.folderUuid, personalType.folderUuid);
});

test('workspace vocabulary remains available when no personal override exists', () => {
  const result = preferPersonalVocabulary([workspaceType], ownerUuid);

  assert.deepEqual(
    result.map((item) => item.uuid),
    [workspaceType.uuid],
  );
});

function createVocabularyItem(overrides: Partial<VocabularyItem>): VocabularyItem {
  return {
    uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ownerUuid: null,
    name: 'Value',
    translations: {},
    description: null,
    folderUuid: null,
    active: true,
    scope: overrides.ownerUuid ? 'personal' : 'system',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}
