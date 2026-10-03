import type { VocabularyItem } from '@binder/common';

/**
 * Keeps one vocabulary item per name for AI classification.
 *
 * Personal values must win over workspace values even when the database does
 * not return them in the expected order. The selected UUID is later returned
 * by the AI and is also used for metadata-based folder routing.
 */
export function preferPersonalVocabulary(
  items: VocabularyItem[],
  ownerUuid: string,
): VocabularyItem[] {
  const selected = new Map<string, VocabularyItem>();

  for (const item of items) {
    const name = normalizeVocabularyName(item.name);
    const current = selected.get(name);

    if (!current || (isPersonal(item, ownerUuid) && !isPersonal(current, ownerUuid))) {
      selected.set(name, item);
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  );
}

function isPersonal(item: VocabularyItem, ownerUuid: string): boolean {
  return item.ownerUuid?.toLowerCase() === ownerUuid.toLowerCase();
}

function normalizeVocabularyName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}
