import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import {
  CreateVocabularyItem,
  CreateMetadataDefinition,
  MetadataDefinitionsResponseSchema,
  DocumentMetadataSchema,
  DocumentMetadataSummarySchema,
  DocumentTitleSuggestionSchema,
  SetDocumentMetadataInput,
  UpdateVocabularyItem,
  VocabularyItem,
  VocabularyDeleteResponseSchema,
  VocabularyResponse,
  VocabularyResponseSchema,
} from '@binder/common';
import { DocumentCategory, DocumentTag, DocumentType } from '../models/vocabulary.entity';
import { MetadataStore } from '../store/metadata.store';
import { FolderService } from '../../folder/service/folder.service';

type VocabularyKind = 'documentTypes' | 'categories' | 'tags';

@Injectable()
export class MetadataService {
  constructor(
    private readonly store: MetadataStore,
    private readonly folders: FolderService,
  ) {}

  async list(ownerUuid: string) {
    const [documentTypes, categories, tags] = await Promise.all([
      this.store.list(DocumentType, ownerUuid),
      this.store.list(DocumentCategory, ownerUuid),
      this.store.list(DocumentTag, ownerUuid),
    ]);
    return VocabularyResponseSchema.parse({
      documentTypes: documentTypes.map((item) => this.toResponse(item)),
      categories: categories.map((item) => this.toResponse(item)),
      tags: tags.map((item) => this.toResponse(item)),
    });
  }

  async create(
    kind: VocabularyKind,
    ownerUuid: string,
    input: CreateVocabularyItem,
    isAdmin: boolean,
  ): Promise<VocabularyItem> {
    if (input.scope === 'system' && !isAdmin) {
      throw new BadRequestException('Only administrators can create system vocabulary entries');
    }
    if (input.folderUuid && input.scope === 'system') {
      throw new BadRequestException(
        'Workspace vocabulary entries cannot be linked to personal folders',
      );
    }
    if (input.folderUuid && kind === 'tags') {
      throw new BadRequestException('Tags cannot be linked to automatic folders');
    }
    if (input.folderUuid) await this.folders.ensureOwned(ownerUuid, input.folderUuid);
    const model = this.modelFor(kind);
    const item = await this.store.create(
      model,
      input.scope === 'system' ? null : ownerUuid,
      input.name,
      input.description ?? null,
      input.translations ?? {},
      input.folderUuid ?? null,
    );
    return this.toResponse(item);
  }

  async update(
    kind: VocabularyKind,
    ownerUuid: string,
    uuid: string,
    input: UpdateVocabularyItem,
    isAdmin: boolean,
  ): Promise<VocabularyItem> {
    const model = this.modelFor(kind);
    const existing = await model.findByPk(uuid);
    if (!existing || (existing.ownerUuid !== null && existing.ownerUuid !== ownerUuid)) {
      throw new NotFoundException('Metadata value not found');
    }
    if (existing.ownerUuid === null && !isAdmin) {
      throw new BadRequestException('Only administrators can update workspace vocabulary entries');
    }
    if (input.folderUuid && kind === 'tags') {
      throw new BadRequestException('Tags cannot be linked to automatic folders');
    }
    if (input.folderUuid && existing.ownerUuid === null) {
      throw new BadRequestException(
        'Workspace vocabulary entries cannot be linked to personal folders',
      );
    }
    if (input.folderUuid) await this.folders.ensureOwned(ownerUuid, input.folderUuid);
    if (input.name && input.name.toLocaleLowerCase() !== existing.name.toLocaleLowerCase()) {
      const duplicate = await model.findOne({
        where: {
          uuid: { [Op.ne]: uuid },
          ownerUuid: existing.ownerUuid,
          name: { [Op.iLike]: input.name },
        },
      });
      if (duplicate) throw new BadRequestException(`A value named '${input.name}' already exists`);
    }
    const updated = await this.store.update(model, uuid, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.translations === undefined ? {} : { translations: input.translations }),
      ...(kind === 'tags' || input.folderUuid === undefined
        ? {}
        : { folderUuid: input.folderUuid }),
    });
    if (!updated) throw new NotFoundException('Metadata value not found');
    return this.toResponse(updated);
  }

  async clone(kind: VocabularyKind, ownerUuid: string, uuid: string): Promise<VocabularyItem> {
    if (kind === 'tags') {
      throw new BadRequestException(
        'Only document types and categories can be copied to personal vocabulary',
      );
    }

    const model = this.modelFor(kind);
    const source = await model.findOne({
      where: {
        uuid,
        active: true,
        ownerUuid: { [Op.or]: [null, ownerUuid] },
      },
    });
    if (!source) throw new NotFoundException('Metadata value not found');
    if (source.ownerUuid !== null) {
      throw new BadRequestException('Only workspace values can be copied to personal vocabulary');
    }

    try {
      const copy = await this.store.create(
        model,
        ownerUuid,
        source.name,
        source.description,
        source.translations ?? {},
        null,
      );
      return this.toResponse(copy);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Unable to copy metadata value',
      );
    }
  }

  async remove(kind: VocabularyKind, ownerUuid: string, uuid: string, isAdmin: boolean) {
    if (kind === 'tags') {
      throw new BadRequestException('Tags cannot be deleted from this screen');
    }

    const model = this.modelFor(kind);
    const existing = await model.findByPk(uuid);
    if (
      !existing ||
      !existing.active ||
      (existing.ownerUuid !== null && existing.ownerUuid !== ownerUuid)
    ) {
      throw new NotFoundException('Metadata value not found');
    }
    if (existing.ownerUuid === null && !isAdmin) {
      throw new BadRequestException('Only administrators can delete workspace vocabulary entries');
    }

    await this.store.update(model, uuid, { active: false });
    return VocabularyDeleteResponseSchema.parse({ deleted: true, uuid });
  }

  async listDefinitions(ownerUuid: string) {
    const items = await this.store.listDefinitions(ownerUuid);
    return MetadataDefinitionsResponseSchema.parse({
      items: items.map((item) => ({
        uuid: item.uuid,
        ownerUuid: item.ownerUuid,
        key: item.key,
        label: item.label,
        type: item.type,
        options: item.options,
        unique: item.unique,
        mandatory: item.mandatory,
        active: item.active,
        scope: item.ownerUuid === null ? 'system' : 'personal',
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  }

  async listForAnalysis(ownerUuid: string): Promise<VocabularyResponse> {
    const vocabulary = await this.list(ownerUuid);
    return VocabularyResponseSchema.parse({
      documentTypes: this.preferPersonal(vocabulary.documentTypes),
      categories: this.preferPersonal(vocabulary.categories),
      tags: this.preferPersonal(vocabulary.tags),
    });
  }

  async createDefinition(ownerUuid: string, input: CreateMetadataDefinition, isAdmin: boolean) {
    if (input.scope === 'system' && !isAdmin) {
      throw new BadRequestException('Only administrators can create system metadata fields');
    }
    const definition = await this.store.createDefinition(
      input.scope === 'system' ? null : ownerUuid,
      input,
    );
    return {
      uuid: definition.uuid,
      ownerUuid: definition.ownerUuid,
      key: definition.key,
      label: definition.label,
      type: definition.type,
      options: definition.options,
      unique: definition.unique,
      mandatory: definition.mandatory,
      active: definition.active,
      scope: definition.ownerUuid === null ? 'system' : 'personal',
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    };
  }

  async getDocumentMetadata(ownerUuid: string, documentUuid: string) {
    const metadata = await this.store.getDocumentMetadata(ownerUuid, documentUuid);
    if (!metadata) throw new NotFoundException('Document not found');
    const suggestion = metadata.suggestion
      ? DocumentTitleSuggestionSchema.safeParse(metadata.suggestion)
      : null;
    return DocumentMetadataSchema.parse({
      issuer: metadata.issuer
        ? {
            uuid: metadata.issuer.uuid,
            ownerUuid: metadata.issuer.ownerUuid,
            name: metadata.issuer.name,
            address: metadata.issuer.address,
            zipCode: metadata.issuer.zipCode,
            city: metadata.issuer.city,
            country: metadata.issuer.country,
            custom: metadata.issuer.custom ?? {},
            folderUuid: metadata.issuer.folderUuid,
            createdAt: metadata.issuer.createdAt.toISOString(),
            updatedAt: metadata.issuer.updatedAt.toISOString(),
          }
        : null,
      documentType: metadata.documentType ? this.toResponse(metadata.documentType) : null,
      category: metadata.category ? this.toResponse(metadata.category) : null,
      tags: metadata.tags.map((tag) => this.toResponse(tag)),
      custom: metadata.custom,
      suggestion: suggestion?.success ? suggestion.data : null,
    });
  }

  async getDocumentMetadataSummaries(
    ownerUuid: string,
    documents: Array<{
      uuid: string;
      documentTypeUuid: string | null;
      categoryUuid: string | null;
      issuerUuid: string | null;
    }>,
  ) {
    const summaries = await this.store.getDocumentMetadataSummaries(ownerUuid, documents);
    return new Map(
      [...summaries.entries()].map(([uuid, summary]) => [
        uuid,
        DocumentMetadataSummarySchema.parse({
          documentType: summary.documentType
            ? {
                uuid: summary.documentType.uuid,
                name: summary.documentType.name,
                translations: summary.documentType.translations ?? {},
              }
            : null,
          category: summary.category
            ? {
                uuid: summary.category.uuid,
                name: summary.category.name,
                translations: summary.category.translations ?? {},
              }
            : null,
          issuer: summary.issuer ? { uuid: summary.issuer.uuid, name: summary.issuer.name } : null,
          tags: summary.tags.map((tag) => ({
            uuid: tag.uuid,
            name: tag.name,
            translations: tag.translations ?? {},
          })),
          custom: summary.custom,
        }),
      ]),
    );
  }

  async setDocumentMetadata(
    ownerUuid: string,
    documentUuid: string,
    input: SetDocumentMetadataInput,
  ) {
    try {
      const metadata = await this.store.setDocumentMetadata(
        ownerUuid,
        documentUuid,
        input.issuerUuid,
        input.documentTypeUuid,
        input.categoryUuid,
        input.tagUuids,
      );
      if (!metadata) throw new NotFoundException('Document not found');
      if (input.custom !== undefined) {
        await this.store.setCustomValues(ownerUuid, documentUuid, input.custom);
      }
      const result = await this.getDocumentMetadata(ownerUuid, documentUuid);
      const routingFolders = [
        result?.issuer?.folderUuid,
        result?.documentType?.folderUuid,
        result?.category?.folderUuid,
      ].filter((uuid): uuid is string => Boolean(uuid));
      if (routingFolders.length > 0) {
        await this.folders.applyMetadataRouting(ownerUuid, documentUuid, routingFolders);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid document metadata',
      );
    }
  }

  private modelFor(kind: VocabularyKind) {
    if (kind === 'documentTypes') return DocumentType;
    if (kind === 'categories') return DocumentCategory;
    return DocumentTag;
  }

  private preferPersonal(items: VocabularyItem[]): VocabularyItem[] {
    const names = new Set<string>();
    return items.filter((item) => {
      const key = item.name.trim().toLocaleLowerCase();
      if (names.has(key)) return false;
      names.add(key);
      return true;
    });
  }

  private toResponse(item: {
    uuid: string;
    ownerUuid: string | null;
    name: string;
    translations: Record<string, string>;
    description: string | null;
    folderUuid?: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): VocabularyItem {
    return {
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      name: item.name,
      translations: item.translations ?? {},
      description: item.description,
      folderUuid: item.folderUuid ?? null,
      active: item.active,
      scope: item.ownerUuid === null ? 'system' : 'personal',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
