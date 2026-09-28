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
      where: { jobKey: { [Op.in]: ['backup', 'backup-retention'] } },
      order: [['createdAt', 'DESC']],
      limit
    });
  }
}
