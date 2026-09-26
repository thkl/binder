import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { DocumentStore } from '../../document/store/document.store';
import { DocumentCategory, DocumentTag, DocumentTagAssignment, DocumentType } from '../models/vocabulary.entity';

type VocabularyModel = typeof DocumentType | typeof DocumentCategory | typeof DocumentTag;

@Injectable()
export class MetadataStore {
  constructor(private readonly documents: DocumentStore) {}

  list(model: VocabularyModel, ownerUuid: string) {
    return model.findAll({
      where: { active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } },
      order: [['name', 'ASC']]
    });
  }

  async findAvailable(model: VocabularyModel, uuid: string, ownerUuid: string) {
    return model.findOne({
      where: { uuid, active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } }
    });
  }

  create(model: VocabularyModel, ownerUuid: string | null, name: string, description: string | null) {
    return model.create({
      uuid: undefined,
      ownerUuid,
      name,
      description,
      active: true
    } as never);
  }

  async getDocumentMetadata(ownerUuid: string, documentUuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) return null;

    const [documentType, category, assignments] = await Promise.all([
      document.documentTypeUuid ? DocumentType.findByPk(document.documentTypeUuid) : null,
      document.categoryUuid ? DocumentCategory.findByPk(document.categoryUuid) : null,
      DocumentTagAssignment.findAll({ where: { documentUuid } })
    ]);
    const tags = assignments.length === 0
      ? []
      : await DocumentTag.findAll({ where: { uuid: { [Op.in]: assignments.map((item) => item.tagUuid) } } });

    return { documentType, category, tags };
  }

  async setDocumentMetadata(
    ownerUuid: string,
    documentUuid: string,
    documentTypeUuid: string | null | undefined,
    categoryUuid: string | null | undefined,
    tagUuids: string[] | undefined
  ) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) return null;

    const [documentType, category, tags] = await Promise.all([
      documentTypeUuid === undefined || documentTypeUuid === null
        ? null
        : this.findAvailable(DocumentType, documentTypeUuid, ownerUuid),
      categoryUuid === undefined || categoryUuid === null
        ? null
        : this.findAvailable(DocumentCategory, categoryUuid, ownerUuid),
      tagUuids === undefined
        ? undefined
        : Promise.all([...new Set(tagUuids)].map((uuid) => this.findAvailable(DocumentTag, uuid, ownerUuid)))
    ]);

    if (documentTypeUuid && !documentType) throw new Error('Document type is not available');
    if (categoryUuid && !category) throw new Error('Category is not available');
    if (tags && tags.some((tag) => !tag)) throw new Error('One or more tags are not available');

    const update: Record<string, unknown> = {};
    if (documentTypeUuid !== undefined) update.documentTypeUuid = documentTypeUuid;
    if (categoryUuid !== undefined) update.categoryUuid = categoryUuid;
    const updated = Object.keys(update).length > 0
      ? await this.documents.update(documentUuid, update)
      : document;

    if (tagUuids !== undefined) {
      await DocumentTagAssignment.destroy({ where: { documentUuid } });
      if (tags && tags.length > 0) {
        await DocumentTagAssignment.bulkCreate(tags.filter((tag): tag is NonNullable<typeof tag> => tag !== null).map((tag) => ({
          documentUuid,
          tagUuid: tag.uuid
        })));
      }
    }

    return this.getDocumentMetadata(ownerUuid, updated?.uuid ?? documentUuid);
  }
}
