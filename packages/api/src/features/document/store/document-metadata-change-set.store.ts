import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentMetadataChangeSet } from '../models/document-metadata-change-set.entity';

@Injectable()
export class DocumentMetadataChangeSetStore extends BaseCrudStore<DocumentMetadataChangeSet> {
  constructor() {
    super(DocumentMetadataChangeSet);
    this.registerIdField('uuid');
  }

  async findOwned(ownerUuid: string, uuid: string): Promise<DocumentMetadataChangeSet | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }
}
