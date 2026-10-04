import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { MaintenanceRun } from '../models/maintenance-run.entity';

@Injectable()
export class MaintenanceRunStore extends BaseCrudStore<MaintenanceRun> {
  constructor() {
    super(MaintenanceRun);
    this.registerIdField('uuid');
  }

  listRecent(limit = 50): Promise<MaintenanceRun[]> {
    return this.model.findAll({
      where: { jobKey: { [Op.in]: ['backup', 'backup-retention', 'storage-consistency'] } },
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

  findRunning(jobKey: MaintenanceRun['jobKey']): Promise<MaintenanceRun | null> {
    return this.model.findOne({ where: { jobKey, status: 'running' } });
  }

  async failStaleRuns(maxAgeMs = 2 * 60 * 60 * 1000): Promise<number> {
    const [count] = await this.model.update(
      {
        status: 'failed',
        finishedAt: new Date(),
        error: 'Maintenance run exceeded the stale-run timeout',
      },
      {
        where: {
          status: 'running',
          startedAt: { [Op.lt]: new Date(Date.now() - maxAgeMs) },
        },
      },
    );
    return count;
  }
}
