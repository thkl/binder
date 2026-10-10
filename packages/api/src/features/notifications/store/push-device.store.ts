import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { PushDevice } from '../models/push-device.entity';

@Injectable()
export class PushDeviceStore extends BaseCrudStore<PushDevice> {
  constructor() {
    super(PushDevice);
    this.registerIdField('uuid');
  }

  async register(ownerUuid: string, token: string, environment: 'sandbox' | 'production'): Promise<void> {
    await this.model.upsert({ ownerUuid, token, environment });
  }

  async findForOwner(ownerUuid: string): Promise<PushDevice[]> {
    return this.model.findAll({ where: { ownerUuid }, order: [['createdAt', 'ASC']] });
  }

  async unregister(ownerUuid: string, token: string): Promise<void> {
    await this.model.destroy({ where: { ownerUuid, token } });
  }

  async deleteToken(token: string): Promise<void> {
    await this.model.destroy({ where: { token: { [Op.eq]: token } } });
  }
}
