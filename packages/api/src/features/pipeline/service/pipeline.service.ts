import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DocumentPipelineResponse,
  DocumentPipelineResponseSchema,
  PipelineJob,
  PipelineJobEvent
} from '@binder/common';
import { PipelineJobKind, PipelineJob as PipelineJobEntity } from '../models/pipeline-job.entity';
import { PipelineJobEventStore } from '../store/pipeline-job-event.store';
import { PipelineJobStore } from '../store/pipeline-job.store';

@Injectable()
export class PipelineService {
  constructor(
    private readonly jobs: PipelineJobStore,
    private readonly events: PipelineJobEventStore,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async enqueue(
    documentUuid: string,
    ownerUuid: string,
    kind: PipelineJobKind = 'text-extraction'
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
      lastError: null
    });
    await this.events.create({ uuid: undefined, jobUuid: job.uuid, type: 'queued', message: `Queued ${kind}` });
    this.eventEmitter.emit('pipeline.job.queued', {
      jobUuid: job.uuid,
      documentUuid,
      ownerUuid,
      kind
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
      events: events.map((event) => this.toEventResponse(event))
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
      updatedAt: job.updatedAt.toISOString()
    };
  }

  private toEventResponse(event: import('../models/pipeline-job-event.entity').PipelineJobEvent): PipelineJobEvent {
    return {
      uuid: event.uuid,
      jobUuid: event.jobUuid,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString()
    };
  }
}

