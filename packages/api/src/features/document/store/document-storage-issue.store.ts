import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentStorageIssue } from '../models/document-storage-issue.entity';

@Injectable()
export class DocumentStorageIssueStore extends BaseCrudStore<DocumentStorageIssue> {
  constructor() {
    super(DocumentStorageIssue);
    this.registerIdField('uuid');
  }

  findOpenOwned(ownerUuid: string): Promise<DocumentStorageIssue[]> {
    return this.model.findAll({
      where: { ownerUuid, status: 'open' },
      order: [['lastDetectedAt', 'DESC'], ['documentUuid', 'ASC']]
    });
  }

  findOpenByDocumentUuids(documentUuids: string[]): Promise<DocumentStorageIssue[]> {
    if (documentUuids.length === 0) return Promise.resolve([]);
    return this.model.findAll({
      where: { documentUuid: { [Op.in]: documentUuids }, status: 'open' }
    });
  }
}
