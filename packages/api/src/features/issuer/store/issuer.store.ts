import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { Issuer } from '../models/issuer.entity';

@Injectable()
export class IssuerStore extends BaseCrudStore<Issuer> {
  constructor() {
    super(Issuer);
    this.registerIdField('uuid');
  }

  async findOwned(ownerUuid: string, uuid: string): Promise<Issuer | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  async listOwned(ownerUuid: string, query?: string): Promise<Issuer[]> {
    return this.model.findAll({
      where: {
        ownerUuid,
        ...(query?.trim() ? { name: { [Op.iLike]: `%${query.trim()}%` } } : {})
      },
      order: [['name', 'ASC']]
    });
  }
}
