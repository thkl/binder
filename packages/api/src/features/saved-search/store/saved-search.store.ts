import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { SavedSearch } from '../models/saved-search.entity';

@Injectable()
export class SavedSearchStore extends BaseCrudStore<SavedSearch> {
  constructor() {
    super(SavedSearch);
    this.registerIdField('uuid');
  }

  listOwned(ownerUuid: string): Promise<SavedSearch[]> {
    return this.model.findAll({
      where: { ownerUuid },
      order: [['name', 'ASC'], ['createdAt', 'ASC'], ['uuid', 'ASC']]
    });
  }

  findOwned(ownerUuid: string, uuid: string): Promise<SavedSearch | null> {
    return this.model.findOne({ where: { ownerUuid, uuid } });
  }
}
