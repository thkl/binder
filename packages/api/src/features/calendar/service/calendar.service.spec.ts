import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CalendarService } from './calendar.service';

const ownerUuid = '11111111-1111-4111-8111-111111111111';
const documentUuid = '22222222-2222-4222-8222-222222222222';

function createEvent(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-10-02T10:00:00.000Z');
  return {
    uuid: '33333333-3333-4333-8333-333333333333',
    documentUuid,
    ownerUuid,
    eventUid: `document-${documentUuid}@binder`,
    dueDate: '2026-10-15',
    title: 'Insurance renewal',
    description: 'Binder document due date: 2026-10-15',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const events = {
    findOwned: async () => [],
    findOwnedByDocument: async () => null,
    findOwnedDocumentUuids: async () => new Set<string>(),
    upsertForDocument: async (input: Record<string, unknown>) => createEvent(input),
    removeForDocument: async () => 1,
    ...overrides,
  };
  const documents = {
    findOwnedByUuid: async () => ({
      uuid: documentUuid,
      title: 'Insurance renewal',
      originalFilename: '2026-insurance.pdf',
    }),
  };
  const metadata = {
    getDocumentMetadata: async () => ({ custom: { dueDate: '2026-10-15' } }),
  };
  const settings = {
    get: async (key: string, fallback: string) => (key === 'calendar.enabled' ? 'true' : fallback),
  };
  const config = {
    get: () => 'api/v1',
  };

  return new CalendarService(
    events as never,
    documents as never,
    metadata as never,
    settings as never,
    config as never,
  );
}

describe('calendar service', () => {
  it('creates an owner-scoped event from a valid due date', async () => {
    let upsertInput: Record<string, unknown> | undefined;
    const service = createService({
      upsertForDocument: async (input: Record<string, unknown>) => {
        upsertInput = input;
        return createEvent(input);
      },
    });

    const event = await service.synchronizeFromUser(ownerUuid, documentUuid);

    assert.equal(event?.dueDate, '2026-10-15');
    assert.equal(upsertInput?.['ownerUuid'], ownerUuid);
    assert.equal(upsertInput?.['documentUuid'], documentUuid);
  });

  it('renders an all-day iCalendar event with an exclusive end date', async () => {
    const service = createService({
      findOwnedByDocument: async () => createEvent(),
    });

    const result = await service.download(ownerUuid, documentUuid);

    assert.equal(result.filename, 'Insurance renewal.ics');
    assert.match(result.content, /DTSTART;VALUE=DATE:20261015/);
    assert.match(result.content, /DTEND;VALUE=DATE:20261016/);
    assert.match(result.content, /UID:document-22222222-2222-4222-8222-222222222222@binder/);
  });
});
