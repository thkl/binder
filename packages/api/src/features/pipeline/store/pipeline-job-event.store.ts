import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { PipelineJobEvent } from '../models/pipeline-job-event.entity';

@Injectable()
export class PipelineJobEventStore extends BaseCrudStore<PipelineJobEvent> {
  constructor() {
    super(PipelineJobEvent);
    this.registerIdField('uuid');
  }

  async findForJobs(jobUuids: string[]): Promise<PipelineJobEvent[]> {
    if (jobUuids.length === 0) {
      return [];
    }
    return this.model.findAll({
      where: { jobUuid: jobUuids },
      order: [['createdAt', 'ASC']]
    });
  }
}

