import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { InboxItem } from '../models/inbox-item.entity';

@Injectable()
export class InboxItemStore extends BaseCrudStore<InboxItem> {
  constructor() {
    super(InboxItem);
    this.registerIdField('uuid');
  }

  async findQueue(): Promise<InboxItem[]> {
    return this.model.findAll({ order: [['createdAt', 'DESC']] });
  }

  async countAiCandidates(): Promise<number> {
    return this.model.count({ where: { status: 'imported', aiStatus: { [Op.in]: ['pending', 'failed'] } } });
  }

  async findAiCandidates(): Promise<InboxItem[]> {
    return this.model.findAll({
      where: { status: 'imported', documentUuid: { [Op.ne]: null }, aiStatus: { [Op.in]: ['pending', 'failed'] } },
      order: [['createdAt', 'ASC']]
    });
  }

  async findActiveSource(filename: string): Promise<InboxItem | null> {
    return this.model.findOne({
      where: { originalFilename: filename, status: { [Op.in]: ['new', 'processing'] } },
      order: [['createdAt', 'DESC']]
    });
  }
}
