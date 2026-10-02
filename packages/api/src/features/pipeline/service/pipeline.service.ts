import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DocumentPipelineResponse,
  DocumentPipelineResponseSchema,
  PipelineJob,
  PipelineJobEvent,
  PipelineJobMonitorQuery,
  PipelineJobMonitorResponse,
  PipelineJobMonitorResponseSchema,
  PipelineJobRetryResponse,
  PipelineJobRetryResponseSchema,
} from '@binder/common';
import { DocumentStore } from '../../document/store/document.store';
import { PipelineJobKind, PipelineJob as PipelineJobEntity } from '../models/pipeline-job.entity';
import { PipelineJobEventStore } from '../store/pipeline-job-event.store';
import { PipelineJobStore } from '../store/pipeline-job.store';

@Injectable()
export class PipelineService {
  constructor(
    private readonly jobs: PipelineJobStore,
    private readonly events: PipelineJobEventStore,
    private readonly eventEmitter: EventEmitter2,
    private readonly documents: DocumentStore,
  ) {}

  async enqueue(
    documentUuid: string,
    ownerUuid: string,
    kind: PipelineJobKind = 'text-extraction',
  ): Promise<PipelineJob> {
    const active = await this.jobs.findActive(documentUuid, kind);
    if (active) {
      return this.toJobResponse(active);
    }

    const job = await this.jobs.create({
      documentUuid,
      ownerUuid,
      kind,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
    });
    await this.events.create({
      uuid: undefined,
      jobUuid: job.uuid,
      type: 'queued',
      message: `Queued ${kind}`,
    });
    this.eventEmitter.emit('pipeline.job.queued', {
      jobUuid: job.uuid,
      documentUuid,
      ownerUuid,
      kind,
    });
    return this.toJobResponse(job);
  }

  async getForDocument(ownerUuid: string, documentUuid: string): Promise<DocumentPipelineResponse> {
    const jobs = await this.jobs.findForDocument(ownerUuid, documentUuid);
    if (jobs.length === 0) {
      throw new NotFoundException('Document pipeline not found');
    }

    const events = await this.events.findForJobs(jobs.map((job) => job.uuid));
    return DocumentPipelineResponseSchema.parse({
      jobs: jobs.map((job) => this.toJobResponse(job)),
      events: events.map((event) => this.toEventResponse(event)),
    });
  }

  async listJobs(
    ownerUuid: string,
    query: PipelineJobMonitorQuery,
  ): Promise<PipelineJobMonitorResponse> {
    const result = await this.jobs.findOwnedPage(ownerUuid, query);
    const jobUuids = result.rows.map((job) => job.uuid);
    const documentUuids = [...new Set(result.rows.map((job) => job.documentUuid))];

    const [documents, events] = await Promise.all([
      this.documents.findOwnedByUuids(ownerUuid, documentUuids),
      this.events.findForJobs(jobUuids),
    ]);

    const documentsByUuid = new Map(documents.map((document) => [document.uuid, document]));
    const eventsByJobUuid = new Map<string, PipelineJobEvent[]>();
    for (const event of events) {
      const existing = eventsByJobUuid.get(event.jobUuid) ?? [];
      existing.push(this.toEventResponse(event));
      eventsByJobUuid.set(event.jobUuid, existing);
    }

    const totalPages = result.count === 0 ? 0 : Math.ceil(result.count / query.pageSize);
    return PipelineJobMonitorResponseSchema.parse({
      items: result.rows.map((job) => {
        const document = documentsByUuid.get(job.documentUuid);
        return {
          ...this.toJobResponse(job),
          lastError: this.sanitizeFailure(job.lastError),
          documentTitle: document?.title ?? null,
          originalFilename: document?.originalFilename ?? job.documentUuid,
          events: (eventsByJobUuid.get(job.uuid) ?? []).map((event) => ({
            ...event,
            message: this.sanitizeFailure(event.message),
          })),
        };
      }),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.count,
        totalPages,
      },
    });
  }

  async retryJob(ownerUuid: string, uuid: string): Promise<PipelineJobRetryResponse> {
    const job = await this.jobs.findOwnedByUuid(ownerUuid, uuid);
    if (!job) {
      throw new NotFoundException('Pipeline job not found');
    }
    if (!['failed', 'cancelled'].includes(job.status)) {
      throw new ConflictException('Only failed or cancelled jobs can be retried');
    }

    const document = await this.documents.findOwnedByUuid(ownerUuid, job.documentUuid);
    if (!document) {
      throw new NotFoundException('The document for this pipeline job was not found');
    }

    const updated = await this.jobs.update(job.uuid, {
      status: 'queued',
      attempts: 0,
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
    });
    if (!updated) {
      throw new NotFoundException('Pipeline job not found');
    }

    if (job.kind === 'pdfa') {
      await this.documents.update(job.documentUuid, {
        archiveStatus: 'queued',
        archiveError: null,
      });
    }

    await this.events.create({
      uuid: undefined,
      jobUuid: job.uuid,
      type: 'manual-retry',
      message: 'Job manually requeued by the document owner',
    });
    this.eventEmitter.emit('pipeline.job.requeued', {
      jobUuid: job.uuid,
      documentUuid: job.documentUuid,
      ownerUuid,
      kind: job.kind,
    });

    return PipelineJobRetryResponseSchema.parse({
      job: this.toJobResponse(updated),
      requeued: true,
    });
  }

  private toJobResponse(job: PipelineJobEntity): PipelineJob {
    return {
      uuid: job.uuid,
      documentUuid: job.documentUuid,
      ownerUuid: job.ownerUuid,
      kind: job.kind,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      availableAt: job.availableAt.toISOString(),
      lockedAt: job.lockedAt?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private toEventResponse(
    event: import('../models/pipeline-job-event.entity').PipelineJobEvent,
  ): PipelineJobEvent {
    return {
      uuid: event.uuid,
      jobUuid: event.jobUuid,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private sanitizeFailure(message: string | null | undefined): string | null {
    if (!message) return null;

    return message
      .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
      .replace(
        /((?:["']?(?:api[_-]?key|password|secret|token|authorization)["']?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1[redacted]',
      )
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[redacted]')
      .slice(0, 2000);
  }
}
