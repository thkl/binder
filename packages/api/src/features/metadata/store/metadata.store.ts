import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import type { LocalizedText } from '@binder/common';
import { DocumentStore } from '../../document/store/document.store';
import { DocumentCategory, DocumentMetadataValue, DocumentTag, DocumentTagAssignment, DocumentType, MetadataDefinition } from '../models/vocabulary.entity';

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

  create(model: VocabularyModel, ownerUuid: string | null, name: string, description: string | null, translations: LocalizedText = {}) {
    return model.findOne({ where: { ownerUuid, name: { [Op.iLike]: name } } }).then((existing) => {
      if (existing) throw new Error(`A value named '${name}' already exists`);
      return model.create({
      uuid: undefined,
      ownerUuid,
      name,
      translations,
      description,
      active: true
      } as never);
    });
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

    const definitions = await this.listDefinitions(ownerUuid);
    const values = await DocumentMetadataValue.findAll({ where: { documentUuid } });
    const custom = Object.fromEntries(values.flatMap((value) => {
      const definition = definitions.find((item) => item.uuid === value.definitionUuid);
      return definition ? [[definition.key, value.value]] : [];
    }));

    return { documentType, category, tags, custom };
  }

  listDefinitions(ownerUuid: string) {
    return MetadataDefinition.findAll({
      where: { active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } },
      order: [['label', 'ASC']]
    });
  }

  async createDefinition(ownerUuid: string | null, input: {
    key: string;
    label: string;
    type: string;
    options?: string[];
    unique: boolean;
    mandatory: boolean;
  }) {
    const existing = await MetadataDefinition.findOne({ where: { key: input.key } });
    if (existing) throw new Error(`A metadata field with key '${input.key}' already exists`);
    return MetadataDefinition.create({
      uuid: undefined,
      ownerUuid,
      key: input.key,
      label: input.label,
      type: input.type,
      options: input.options ?? null,
      unique: input.unique,
      mandatory: input.mandatory,
      active: true
    } as never);
  }

  async setCustomValues(ownerUuid: string, documentUuid: string, custom: Record<string, unknown>) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) return null;
    const definitions = await this.listDefinitions(ownerUuid);
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));

    for (const definition of definitions) {
      if (definition.mandatory && (custom[definition.key] === undefined || custom[definition.key] === null || custom[definition.key] === '')) {
        throw new Error(`Metadata field '${definition.label}' is required`);
      }
    }
    for (const [key, value] of Object.entries(custom)) {
      const definition = definitionByKey.get(key);
      if (!definition) throw new Error(`Unknown metadata field '${key}'`);
      this.validateValue(definition, value);
      if (definition.unique && value !== null && value !== undefined && value !== '') {
        const existingValues = await DocumentMetadataValue.findAll({ where: { definitionUuid: definition.uuid } });
        const usedByAnotherDocument = existingValues.some((item) =>
          item.documentUuid !== documentUuid && JSON.stringify(item.value) === JSON.stringify(value)
        );
        if (usedByAnotherDocument) throw new Error(`Metadata field '${definition.label}' must be unique`);
      }
      await DocumentMetadataValue.upsert({ documentUuid, definitionUuid: definition.uuid, value });
    }
    return this.getDocumentMetadata(ownerUuid, documentUuid);
  }

  private validateValue(definition: MetadataDefinition, value: unknown): void {
    if (value === null || value === undefined || value === '') {
      if (definition.mandatory) throw new Error(`Metadata field '${definition.label}' is required`);
      return;
    }
    if (definition.type === 'text' && typeof value !== 'string') throw new Error(`Metadata field '${definition.label}' must be text`);
    if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Metadata field '${definition.label}' must be a number`);
    if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Metadata field '${definition.label}' must be boolean`);
    if (definition.type === 'multi-select' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) throw new Error(`Metadata field '${definition.label}' must be a list`);
    if ((definition.type === 'select' || definition.type === 'multi-select') && definition.options) {
      const values = Array.isArray(value) ? value : [value];
      if (values.some((item) => !definition.options?.includes(String(item)))) throw new Error(`Metadata field '${definition.label}' has an invalid option`);
    }
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
