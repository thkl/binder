import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import type { PipelineJobMonitorQuery } from '@binder/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { PipelineJob, PipelineJobKind, PipelineJobStatus } from '../models/pipeline-job.entity';

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
        status: { [Op.in]: ['queued', 'running'] },
      },
    });
  }

  async findForDocument(ownerUuid: string, documentUuid: string): Promise<PipelineJob[]> {
    return this.model.findAll({
      where: { ownerUuid, documentUuid },
      order: [['createdAt', 'ASC']],
    });
  }

  async findOwnedByUuid(ownerUuid: string, uuid: string): Promise<PipelineJob | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  async findOwnedPage(
    ownerUuid: string,
    query: PipelineJobMonitorQuery,
  ): Promise<{ rows: PipelineJob[]; count: number }> {
    const where: {
      ownerUuid: string;
      status?: PipelineJobStatus;
      kind?: PipelineJobKind;
    } = { ownerUuid };

    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;

    const result = await this.model.findAndCountAll({
      where,
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'DESC'],
      ],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });

    return {
      rows: result.rows,
      count: Array.isArray(result.count) ? result.count.length : result.count,
    };
  }
}
