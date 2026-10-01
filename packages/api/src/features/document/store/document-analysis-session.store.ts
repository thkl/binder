import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentAnalysisSession } from '../models/document-analysis-session.entity';

@Injectable()
export class DocumentAnalysisSessionStore extends BaseCrudStore<DocumentAnalysisSession> {
  constructor() {
    super(DocumentAnalysisSession);
    this.registerIdField('uuid');
  }

  findOwned(
    ownerUuid: string,
    documentUuid: string,
    sessionUuid: string,
  ): Promise<DocumentAnalysisSession | null> {
    return this.model.findOne({
      where: {
        uuid: sessionUuid,
        ownerUuid,
        documentUuid,
      },
    });
  }

  findActiveOwned(
    ownerUuid: string,
    documentUuid: string,
    now = new Date(),
  ): Promise<DocumentAnalysisSession | null> {
    return this.model.findOne({
      where: {
        ownerUuid,
        documentUuid,
        fileExpiresAt: { [Op.gt]: now },
      },
      order: [['createdAt', 'DESC']],
    });
  }
}
