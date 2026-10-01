import { Injectable } from '@nestjs/common';
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
}
