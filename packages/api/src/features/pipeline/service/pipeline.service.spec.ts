import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PipelineService } from './pipeline.service';

const ownerUuid = '11111111-1111-4111-8111-111111111111';
const documentUuid = '22222222-2222-4222-8222-222222222222';
const jobUuid = '33333333-3333-4333-8333-333333333333';
const eventUuid = '44444444-4444-4444-8444-444444444444';

function createJob(status: 'queued' | 'failed' = 'failed') {
  const now = new Date('2026-10-02T09:00:00.000Z');
  return {
    uuid: jobUuid,
    documentUuid,
    ownerUuid,
    kind: 'pdfa' as const,
    status,
    attempts: status === 'failed' ? 3 : 0,
    maxAttempts: 3,
    availableAt: now,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    completedAt: status === 'failed' ? now : null,
    lastError: status === 'failed' ? 'password=secret Bearer abc123' : null,
    createdAt: now,
    updatedAt: now,
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const jobs = {
    findOwnedPage: async () => ({ rows: [createJob()], count: 1 }),
    findOwnedByUuid: async () => createJob(),
    update: async () => ({ ...createJob('queued'), lastError: null }),
    ...overrides,
  };
  const events = {
    findForJobs: async () => [
      {
        uuid: eventUuid,
        jobUuid,
        type: 'failed',
        message: '{"token":"secret-value"}',
        createdAt: new Date('2026-10-02T09:00:00.000Z'),
      },
    ],
    create: async (event: unknown) => event,
  };
  const documents = {
    findOwnedByUuids: async () => [
      { uuid: documentUuid, title: 'Archive document', originalFilename: 'document.pdf' },
    ],
    findOwnedByUuid: async () => ({ uuid: documentUuid }),
    update: async () => null,
  };
  const eventEmitter = { emit: () => true };

  return new PipelineService(
    jobs as never,
    events as never,
    eventEmitter as never,
    documents as never,
  );
}

describe('pipeline service', () => {
  it('maps owner jobs and redacts secrets from monitor details', async () => {
    const service = createService();

    const response = await service.listJobs(ownerUuid, { page: 1, pageSize: 25 });

    assert.equal(response.items[0]?.documentTitle, 'Archive document');
    assert.equal(response.items[0]?.lastError, 'password=[redacted] Bearer [redacted]');
    assert.equal(response.items[0]?.events[0]?.message, '{"token":[redacted]}');
  });

  it('requeues a failed job and resets its retry state', async () => {
    let updatedData: Record<string, unknown> | undefined;
    let createdEvent: Record<string, unknown> | undefined;
    const service = createService({
      update: async (_uuid: string, data: Record<string, unknown>) => {
        updatedData = data;
        return { ...createJob('queued'), ...data };
      },
    });
    const serviceWithEventSpy = service as unknown as {
      events: { create: (event: Record<string, unknown>) => Promise<unknown> };
    };
    serviceWithEventSpy.events.create = async (event) => {
      createdEvent = event;
      return event;
    };

    const response = await service.retryJob(ownerUuid, jobUuid);

    assert.equal(response.requeued, true);
    assert.equal(updatedData?.['status'], 'queued');
    assert.equal(updatedData?.['attempts'], 0);
    assert.equal(updatedData?.['lastError'], null);
    assert.equal(createdEvent?.['type'], 'manual-retry');
  });
});
