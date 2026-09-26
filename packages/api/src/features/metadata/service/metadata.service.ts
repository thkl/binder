import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateVocabularyItem,
  DocumentMetadataSchema,
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
    const item = await this.store.create(model, input.scope === 'system' ? null : ownerUuid, input.name, input.description ?? null);
    return this.toResponse(item);
  }

  async getDocumentMetadata(ownerUuid: string, documentUuid: string) {
    const metadata = await this.store.getDocumentMetadata(ownerUuid, documentUuid);
    if (!metadata) throw new NotFoundException('Document not found');
    return DocumentMetadataSchema.parse({
      documentType: metadata.documentType ? this.toResponse(metadata.documentType) : null,
      category: metadata.category ? this.toResponse(metadata.category) : null,
      tags: metadata.tags.map((tag) => this.toResponse(tag))
    });
  }

  async setDocumentMetadata(ownerUuid: string, documentUuid: string, input: SetDocumentMetadataInput) {
    try {
      const metadata = await this.store.setDocumentMetadata(
        ownerUuid,
        documentUuid,
        input.documentTypeUuid,
        input.categoryUuid,
        input.tagUuids
      );
      if (!metadata) throw new NotFoundException('Document not found');
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

  private toResponse(item: { uuid: string; ownerUuid: string | null; name: string; description: string | null; active: boolean; createdAt: Date; updatedAt: Date }): VocabularyItem {
    return {
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      name: item.name,
      description: item.description,
      active: item.active,
      scope: item.ownerUuid === null ? 'system' : 'personal',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }
}
