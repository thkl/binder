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

  async removeCompleted(completionStage: 'import' | 'ai-analysis'): Promise<number> {
    return this.model.destroy({
      where: completionStage === 'import'
        ? { status: 'imported' }
        : { status: 'imported', aiStatus: 'ready' }
    });
  }

  async remove(uuid: string): Promise<number> {
    return this.model.destroy({ where: { uuid } });
  }

  async removeByStatus(status: 'duplicate' | 'rejected'): Promise<number> {
    return this.model.destroy({ where: { status } });
  }

  async changeToken(): Promise<string> {
    const latest = await this.model.findOne({
      attributes: ['uuid', 'updatedAt'],
      order: [['updatedAt', 'DESC']]
    });
    return latest ? `${latest.uuid}:${latest.updatedAt.toISOString()}` : 'empty';
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
