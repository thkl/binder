import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateSavedSearchInput,
  CreateSavedSearchInputSchema,
  SavedSearchDeleteResponseSchema,
  SavedSearchListResponseSchema,
  SavedSearchSchema,
  UpdateSavedSearchInput,
  UpdateSavedSearchInputSchema
} from '@binder/common';
import { SavedSearchStore } from '../store/saved-search.store';

@Injectable()
export class SavedSearchService {
  constructor(private readonly savedSearches: SavedSearchStore) {}

  async list(ownerUuid: string) {
    const items = await this.savedSearches.listOwned(ownerUuid);
    return SavedSearchListResponseSchema.parse({
      items: items.map((item) => this.toResponse(item))
    });
  }

  async create(ownerUuid: string, input: CreateSavedSearchInput) {
    const parsed = CreateSavedSearchInputSchema.parse(input);

    try {
      const savedSearch = await this.savedSearches.create({
        uuid: undefined,
        ownerUuid,
        name: parsed.name,
        kind: parsed.definition.kind,
        definition: parsed.definition
      });
      return this.toResponse(savedSearch);
    } catch (error) {
      this.throwNameConflict(error);
    }
  }

  async update(ownerUuid: string, uuid: string, input: UpdateSavedSearchInput) {
    const existing = await this.savedSearches.findOwned(ownerUuid, uuid);
    if (!existing) throw new NotFoundException('Saved search not found');

    const parsed = UpdateSavedSearchInputSchema.parse(input);
    const definition = parsed.definition ?? existing.definition;

    try {
      const updated = await this.savedSearches.update(uuid, {
        name: parsed.name ?? existing.name,
        kind: definition.kind,
        definition
      });
      return this.toResponse(updated ?? existing);
    } catch (error) {
      this.throwNameConflict(error);
    }
  }

  async remove(ownerUuid: string, uuid: string) {
    const existing = await this.savedSearches.findOwned(ownerUuid, uuid);
    if (!existing) throw new NotFoundException('Saved search not found');

    await existing.destroy();
    return SavedSearchDeleteResponseSchema.parse({ deleted: true, uuid });
  }

  private toResponse(item: import('../models/saved-search.entity').SavedSearch) {
    return SavedSearchSchema.parse({
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      name: item.name,
      definition: item.definition,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    });
  }

  private throwNameConflict(error: unknown): never {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      throw new ConflictException('A saved search with this name already exists');
    }
    throw error;
  }
}
