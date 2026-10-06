import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { MaintenanceRequest } from '../models/maintenance-request.entity';

@Injectable()
export class MaintenanceRequestStore extends BaseCrudStore<MaintenanceRequest> {
  constructor() {
    super(MaintenanceRequest);
    this.registerIdField('uuid');
  }

  findPendingBackup(): Promise<MaintenanceRequest | null> {
    return this.model.findOne({
      where: { jobKey: 'backup' },
      order: [['createdAt', 'ASC']],
    });
  }

  findPendingRestore(): Promise<MaintenanceRequest | null> {
    return this.model.findOne({
      where: { jobKey: 'restore' },
      order: [['createdAt', 'ASC']],
    });
  }

  async removeStaleBackupRequests(maxAgeMs = 15 * 60 * 1000): Promise<number> {
    const count = await this.model.destroy({
      where: {
        jobKey: 'backup',
        createdAt: { [Op.lt]: new Date(Date.now() - maxAgeMs) },
      },
    });
    return count;
  }
}
