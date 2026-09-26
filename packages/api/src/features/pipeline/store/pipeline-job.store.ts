import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { PipelineJob, PipelineJobKind } from '../models/pipeline-job.entity';

@Injectable()
export class PipelineJobStore extends BaseCrudStore<PipelineJob> {
  constructor() {
    super(PipelineJob);
    this.registerIdField('uuid');
  }

  async findActive(documentUuid: string, kind: PipelineJobKind): Promise<PipelineJob | null> {
    return this.model.findOne({
      where: {
        documentUuid,
        kind,
        status: { [Op.in]: ['queued', 'running'] }
      }
    });
  }

  async findForDocument(ownerUuid: string, documentUuid: string): Promise<PipelineJob[]> {
    return this.model.findAll({
      where: { ownerUuid, documentUuid },
      order: [['createdAt', 'ASC']]
    });
  }
}

