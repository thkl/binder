import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateVocabularyItem,
  CreateMetadataDefinition,
  MetadataDefinitionsResponseSchema,
  DocumentMetadataSchema,
  DocumentMetadataSummarySchema,
  DocumentTitleSuggestionSchema,
  SetDocumentMetadataInput,
  VocabularyItem,
  VocabularyResponseSchema
} from '@binder/common';
import { DocumentCategory, DocumentTag, DocumentType } from '../models/vocabulary.entity';
import { MetadataStore } from '../store/metadata.store';

type VocabularyKind = 'documentTypes' | 'categories' | 'tags';

@Injectable()
export class MetadataService {
  constructor(private readonly store: MetadataStore) {}

  async list(ownerUuid: string) {
    const [documentTypes, categories, tags] = await Promise.all([
      this.store.list(DocumentType, ownerUuid),
      this.store.list(DocumentCategory, ownerUuid),
      this.store.list(DocumentTag, ownerUuid)
    ]);
    return VocabularyResponseSchema.parse({
      documentTypes: documentTypes.map((item) => this.toResponse(item)),
      categories: categories.map((item) => this.toResponse(item)),
      tags: tags.map((item) => this.toResponse(item))
    });
  }

  async create(kind: VocabularyKind, ownerUuid: string, input: CreateVocabularyItem, isAdmin: boolean): Promise<VocabularyItem> {
    if (input.scope === 'system' && !isAdmin) {
      throw new BadRequestException('Only administrators can create system vocabulary entries');
    }
    const model = this.modelFor(kind);
    const item = await this.store.create(model, input.scope === 'system' ? null : ownerUuid, input.name, input.description ?? null, input.translations ?? {});
    return this.toResponse(item);
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
        updatedAt: item.updatedAt.toISOString()
      }))
    });
  }

  async createDefinition(ownerUuid: string, input: CreateMetadataDefinition, isAdmin: boolean) {
    if (input.scope === 'system' && !isAdmin) {
      throw new BadRequestException('Only administrators can create system metadata fields');
    }
    const definition = await this.store.createDefinition(input.scope === 'system' ? null : ownerUuid, input);
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
      updatedAt: definition.updatedAt.toISOString()
    };
  }

  async getDocumentMetadata(ownerUuid: string, documentUuid: string) {
    const metadata = await this.store.getDocumentMetadata(ownerUuid, documentUuid);
    if (!metadata) throw new NotFoundException('Document not found');
    const suggestion = metadata.suggestion ? DocumentTitleSuggestionSchema.safeParse(metadata.suggestion) : null;
    return DocumentMetadataSchema.parse({
      issuer: metadata.issuer ? {
        uuid: metadata.issuer.uuid,
        ownerUuid: metadata.issuer.ownerUuid,
        name: metadata.issuer.name,
        address: metadata.issuer.address,
        zipCode: metadata.issuer.zipCode,
        city: metadata.issuer.city,
        country: metadata.issuer.country,
        custom: metadata.issuer.custom ?? {},
        createdAt: metadata.issuer.createdAt.toISOString(),
        updatedAt: metadata.issuer.updatedAt.toISOString()
      } : null,
      documentType: metadata.documentType ? this.toResponse(metadata.documentType) : null,
      category: metadata.category ? this.toResponse(metadata.category) : null,
      tags: metadata.tags.map((tag) => this.toResponse(tag)),
      custom: metadata.custom,
      suggestion: suggestion?.success ? suggestion.data : null
    });
  }

  async getDocumentMetadataSummaries(ownerUuid: string, documents: Array<{ uuid: string; documentTypeUuid: string | null; categoryUuid: string | null; issuerUuid: string | null }>) {
    const summaries = await this.store.getDocumentMetadataSummaries(ownerUuid, documents);
    return new Map([...summaries.entries()].map(([uuid, summary]) => [uuid, DocumentMetadataSummarySchema.parse({
      documentType: summary.documentType ? {
        uuid: summary.documentType.uuid,
        name: summary.documentType.name,
        translations: summary.documentType.translations ?? {}
      } : null,
      category: summary.category ? {
        uuid: summary.category.uuid,
        name: summary.category.name,
        translations: summary.category.translations ?? {}
      } : null,
      issuer: summary.issuer ? { uuid: summary.issuer.uuid, name: summary.issuer.name } : null,
      tags: summary.tags.map((tag) => ({ uuid: tag.uuid, name: tag.name, translations: tag.translations ?? {} })),
      custom: summary.custom
    })]));
  }

  async setDocumentMetadata(ownerUuid: string, documentUuid: string, input: SetDocumentMetadataInput) {
    try {
      const metadata = await this.store.setDocumentMetadata(
        ownerUuid,
        documentUuid,
        input.issuerUuid,
        input.documentTypeUuid,
        input.categoryUuid,
        input.tagUuids
      );
      if (!metadata) throw new NotFoundException('Document not found');
      if (input.custom !== undefined) {
        await this.store.setCustomValues(ownerUuid, documentUuid, input.custom);
      }
      return this.getDocumentMetadata(ownerUuid, documentUuid);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid document metadata');
    }
  }

  private modelFor(kind: VocabularyKind) {
    if (kind === 'documentTypes') return DocumentType;
    if (kind === 'categories') return DocumentCategory;
    return DocumentTag;
  }

  private toResponse(item: { uuid: string; ownerUuid: string | null; name: string; translations: Record<string, string>; description: string | null; active: boolean; createdAt: Date; updatedAt: Date }): VocabularyItem {
    return {
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      name: item.name,
      translations: item.translations ?? {},
      description: item.description,
      active: item.active,
      scope: item.ownerUuid === null ? 'system' : 'personal',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }
}
