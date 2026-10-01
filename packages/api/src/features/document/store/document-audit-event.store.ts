import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentAuditEventEntity } from '../models/document-audit-event.entity';

@Injectable()
export class DocumentAuditEventStore extends BaseCrudStore<DocumentAuditEventEntity> {
  constructor() {
    super(DocumentAuditEventEntity);
    this.registerIdField('uuid');
  }

  async findOwnedPage(
    ownerUuid: string,
    documentUuid: string,
    page: number,
    pageSize: number,
  ): Promise<{
    rows: DocumentAuditEventEntity[];
    count: number;
  }> {
    const result = await this.model.findAndCountAll({
      where: { ownerUuid, documentUuid },
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'DESC'],
      ],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      rows: result.rows,
      count: Array.isArray(result.count) ? result.count.length : result.count,
    };
  }
}
