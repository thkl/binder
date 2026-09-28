import { Injectable } from '@nestjs/common';
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
      order: [['createdAt', 'ASC']]
    });
  }

}
