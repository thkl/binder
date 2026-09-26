import { Injectable } from '@nestjs/common';
import { Op, Order, WhereOptions } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { Document } from '../models/document.entity';
import { DocumentListQuery } from '@binder/common';

@Injectable()
export class DocumentStore extends BaseCrudStore<Document> {
  constructor() {
    super(Document);
    this.registerIdField('uuid');
  }

  async findOwnedByUuid(ownerUuid: string, uuid: string): Promise<Document | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  async findOwnedPage(ownerUuid: string, query: DocumentListQuery) {
    const where: WhereOptions<Document> = { ownerUuid };

    if (query.status) {
      where.status = query.status;
    }

    if (query.q) {
      (where as unknown as Record<PropertyKey, unknown>)[Op.or] = [
        { originalFilename: { [Op.iLike]: `%${query.q}%` } },
        { checksumSha256: { [Op.iLike]: `%${query.q}%` } }
      ];
    }

    const order: Order = [[query.sort, query.direction.toUpperCase() as 'ASC' | 'DESC']];
    const result = await this.model.findAndCountAll({
      where,
      order,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    });

    const total = result.count as number;
    return {
      items: result.rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      hasNext: query.page * query.pageSize < total,
      hasPrev: query.page > 1
    };
  }
}
