import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentShare } from '../models/document-share.entity';

@Injectable()
export class DocumentShareStore extends BaseCrudStore<DocumentShare> {
  constructor() {
    super(DocumentShare);
    this.registerIdField('uuid');
  }

  listForOwnerDocument(ownerUuid: string, documentUuid: string): Promise<DocumentShare[]> {
    return this.model.findAll({
      where: { ownerUuid, documentUuid },
      order: [['createdAt', 'ASC'], ['uuid', 'ASC']],
    });
  }

  listForOwnerDocuments(ownerUuid: string, documentUuids: string[]): Promise<DocumentShare[]> {
    if (documentUuids.length === 0) return Promise.resolve([]);
    return this.model.findAll({ where: { ownerUuid, documentUuid: { [Op.in]: documentUuids } } });
  }

  listForRecipient(recipientUserUuid: string): Promise<DocumentShare[]> {
    return this.model.findAll({
      where: { recipientUserUuid },
      order: [['createdAt', 'DESC'], ['uuid', 'ASC']],
    });
  }

  async createShare(ownerUuid: string, documentUuid: string, recipientUserUuid: string): Promise<void> {
    await this.model.findOrCreate({
      where: { documentUuid, recipientUserUuid },
      defaults: { ownerUuid, documentUuid, recipientUserUuid },
    });
  }

  removeShare(ownerUuid: string, documentUuid: string, recipientUserUuid: string): Promise<number> {
    return this.model.destroy({ where: { ownerUuid, documentUuid, recipientUserUuid } });
  }

  async hasShare(recipientUserUuid: string, documentUuid: string): Promise<boolean> {
    return Boolean(await this.model.findOne({ where: { recipientUserUuid, documentUuid }, attributes: ['uuid'] }));
  }
}
