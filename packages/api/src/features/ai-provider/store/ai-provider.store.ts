import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { AiProviderProfile } from '../models/ai-provider.entity';

@Injectable()
export class AiProviderStore extends BaseCrudStore<AiProviderProfile> {
  constructor() {
    super(AiProviderProfile);
    this.registerIdField('uuid');
  }

  async listAll(): Promise<AiProviderProfile[]> {
    return this.model.findAll({ order: [['name', 'ASC']] });
  }

  async findByUuid(uuid: string): Promise<AiProviderProfile | null> {
    return this.model.findOne({ where: { uuid } });
  }
}
