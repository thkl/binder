import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import {
  BulkMetadataInput,
  BulkMetadataInputSchema,
  BulkMetadataPolicy,
  BulkMetadataPreviewResponse,
  BulkMetadataPreviewResponseSchema,
  BulkMetadataApplyResponseSchema,
  DocumentChangeSet,
  DocumentChangeSetRollbackResponseSchema,
  DocumentChangeSetSchema,
  SetDocumentMetadataInput,
} from '@binder/common';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Document } from '../models/document.entity';
import { DocumentAuditEventEntity } from '../models/document-audit-event.entity';
import { DocumentMetadataChangeSet } from '../models/document-metadata-change-set.entity';
import { DocumentStore } from '../store/document.store';
import { DocumentMetadataChangeSetStore } from '../store/document-metadata-change-set.store';
import {
  DocumentCategory,
  DocumentMetadataValue,
  DocumentTag,
  DocumentTagAssignment,
  DocumentType,
  MetadataDefinition,
} from '../../metadata/models/vocabulary.entity';
import { Issuer } from '../../issuer/models/issuer.entity';
import { DocumentFolder } from '../../folder/models/document-folder.entity';
import { Folder } from '../../folder/models/folder.entity';

type CustomValueSnapshot = {
  present: boolean;
  value: unknown;
};

type MetadataSnapshot = {
  issuerUuid: string | null;
  documentTypeUuid: string | null;
  categoryUuid: string | null;
  tagUuids: string[];
  folderUuids: string[];
  custom: Record<string, CustomValueSnapshot>;
  updatedAt: string;
};

type ChangeEntry = {
  documentUuid: string;
  fields: string[];
  customKeys: string[];
  before: MetadataSnapshot;
  after: MetadataSnapshot;
};

type MetadataField = keyof Pick<
  SetDocumentMetadataInput,
  'issuerUuid' | 'documentTypeUuid' | 'categoryUuid' | 'tagUuids'
>;

@Injectable()
export class DocumentBulkMetadataService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly documents: DocumentStore,
    private readonly changeSets: DocumentMetadataChangeSetStore,
  ) {}

  async preview(
    ownerUuid: string,
    rawInput: BulkMetadataInput,
  ): Promise<BulkMetadataPreviewResponse> {
    const input = BulkMetadataInputSchema.parse(rawInput);
    const context = await this.loadContext(ownerUuid, input);
    const items = await Promise.all(
      context.documents.map(async (document) => this.previewDocument(document, input, context)),
    );

    const response = {
      policy: input.policy,
      requested: input.documentUuids.length,
      eligible: items.filter((item) => item.canApply).length,
      skipped: items.filter((item) => !item.canApply).length,
      conflicts: items.filter((item) => item.conflictingFields.length > 0).length,
      items,
    };

    return BulkMetadataPreviewResponseSchema.parse(response);
  }

  async apply(ownerUuid: string, actorUuid: string, rawInput: BulkMetadataInput) {
    const input = BulkMetadataInputSchema.parse(rawInput);
    const context = await this.loadContext(ownerUuid, input);

    const result = await this.sequelize.transaction(async (transaction) => {
      const changes: ChangeEntry[] = [];
      let skipped = 0;
      let conflicts = 0;
      const revisionAt = new Date();
      const changeSet = await DocumentMetadataChangeSet.create(
        {
          ownerUuid,
          actorUuid,
          policy: input.policy,
          status: 'applied',
          documentCount: 0,
          changes: [],
          rolledBackAt: null,
          rolledBackBy: null,
        },
        { transaction },
      );

      for (const document of context.documents) {
        const before = await this.snapshot(document.uuid, context.customDefinitions, transaction);
        const decision = this.decide(before, document, input, context);
        conflicts += decision.conflictingFields.length > 0 ? 1 : 0;

        if (!decision.canApply) {
          skipped += 1;
          continue;
        }

        await this.applyDecision(
          document,
          input,
          decision.applicableFields,
          context,
          transaction,
          revisionAt,
        );
        const updatedDocument = await Document.findByPk(document.uuid, { transaction });
        if (!updatedDocument) throw new NotFoundException('Document not found');

        const after = await this.snapshot(
          updatedDocument.uuid,
          context.customDefinitions,
          transaction,
        );
        changes.push({
          documentUuid: document.uuid,
          fields: decision.applicableFields,
          customKeys: Object.keys(input.metadata.custom ?? {}),
          before,
          after,
        });

        await DocumentAuditEventEntity.create(
          {
            documentUuid: document.uuid,
            ownerUuid,
            actorUuid,
            actorType: 'user',
            eventType: 'metadata-changed',
            summary: 'Metadata changed in bulk',
            details: {
              fields: decision.applicableFields,
              action: 'bulk',
            },
            changeSetUuid: changeSet.uuid,
          },
          { transaction },
        );
      }

      if (changes.length === 0) {
        throw new BadRequestException('No selected document has an applicable metadata change');
      }

      await changeSet.update(
        {
          documentCount: changes.length,
          changes: changes as unknown as Record<string, unknown>[],
        },
        { transaction },
      );

      return {
        changeSet,
        requested: input.documentUuids.length,
        applied: changes.length,
        skipped,
        conflicts,
      };
    });

    return BulkMetadataApplyResponseSchema.parse({
      changeSet: this.changeSetResponse(result.changeSet),
      requested: result.requested,
      applied: result.applied,
      skipped: result.skipped,
      conflicts: result.conflicts,
    });
  }

  async rollback(ownerUuid: string, actorUuid: string, uuid: string) {
    const changeSet = await this.changeSets.findOwned(ownerUuid, uuid);
    if (!changeSet) throw new NotFoundException('Change set not found');
    if (changeSet.status !== 'applied') {
      throw new ConflictException('This change set has already been rolled back');
    }

    const changes = changeSet.changes as unknown as ChangeEntry[];
    const result = await this.sequelize.transaction(async (transaction) => {
      const documents = await Document.findAll({
        where: {
          ownerUuid,
          uuid: { [Op.in]: changes.map((change) => change.documentUuid) },
        },
        transaction,
      });
      const documentsByUuid = new Map(documents.map((document) => [document.uuid, document]));
      const conflicts = changes
        .map((change) => {
          const document = documentsByUuid.get(change.documentUuid);
          if (!document) return { documentUuid: change.documentUuid, reason: 'Document not found' };
          if (document.updatedAt.getTime() !== new Date(change.after.updatedAt).getTime()) {
            return {
              documentUuid: change.documentUuid,
              reason: 'The document changed after this bulk update',
            };
          }
          return null;
        })
        .filter((item): item is { documentUuid: string; reason: string } => item !== null);

      if (conflicts.length > 0) {
        throw new ConflictException({
          message: 'The change set cannot be rolled back safely',
          conflicts,
        });
      }

      const revisionAt = new Date();
      for (const change of changes) {
        const document = documentsByUuid.get(change.documentUuid);
        if (!document) throw new NotFoundException('Document not found');
        await this.restoreSnapshot(
          document,
          change.before,
          change.customKeys,
          transaction,
          revisionAt,
        );

        await DocumentAuditEventEntity.create(
          {
            documentUuid: document.uuid,
            ownerUuid,
            actorUuid,
            actorType: 'user',
            eventType: 'metadata-changed',
            summary: 'Bulk metadata change rolled back',
            details: {
              fields: change.fields,
              action: 'rollback',
            },
            changeSetUuid: changeSet.uuid,
          },
          { transaction },
        );
      }

      await changeSet.update(
        {
          status: 'rolled-back',
          rolledBackAt: revisionAt,
          rolledBackBy: actorUuid,
        },
        { transaction },
      );

      return { changeSet, rolledBack: changes.length, conflicts: [] };
    });

    return DocumentChangeSetRollbackResponseSchema.parse({
      changeSet: this.changeSetResponse(result.changeSet),
      rolledBack: result.rolledBack,
      conflicts: result.conflicts,
    });
  }

  private async loadContext(ownerUuid: string, input: BulkMetadataInput) {
    const documents = await this.documents.findOwnedByUuids(ownerUuid, input.documentUuids);
    if (documents.length !== input.documentUuids.length) {
      throw new NotFoundException('One or more selected documents are not available');
    }

    const metadata = input.metadata;
    await this.assertVocabulary(ownerUuid, metadata, input.folderUuids);
    const definitions = await MetadataDefinition.findAll({
      where: { active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } },
    });
    const customKeys = Object.keys(metadata.custom ?? {});
    const customDefinitions = definitions.filter((definition) =>
      customKeys.includes(definition.key),
    );
    if (customDefinitions.length !== customKeys.length) {
      throw new BadRequestException('One or more custom metadata fields are not available');
    }

    for (const definition of customDefinitions) {
      this.validateCustomValue(definition, metadata.custom?.[definition.key]);
      await this.validateUniqueCustomValue(
        ownerUuid,
        input.documentUuids,
        definition,
        metadata.custom?.[definition.key],
      );
    }

    return { documents, customDefinitions };
  }

  private async assertVocabulary(
    ownerUuid: string,
    metadata: SetDocumentMetadataInput,
    folderUuids: string[] | undefined,
  ): Promise<void> {
    if (metadata.issuerUuid) {
      const issuer = await Issuer.findOne({ where: { uuid: metadata.issuerUuid, ownerUuid } });
      if (!issuer) throw new BadRequestException('Issuer is not available');
    }

    const vocabularyChecks = [
      [DocumentType, metadata.documentTypeUuid, 'Document type'],
      [DocumentCategory, metadata.categoryUuid, 'Category'],
    ] as const;
    for (const [model, uuid, label] of vocabularyChecks) {
      if (!uuid) continue;
      const item = await model.findOne({
        where: { uuid, active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } },
      });
      if (!item) throw new BadRequestException(`${label} is not available`);
    }

    if (metadata.tagUuids) {
      const tags = await DocumentTag.findAll({
        where: {
          uuid: { [Op.in]: [...new Set(metadata.tagUuids)] },
          active: true,
          ownerUuid: { [Op.or]: [null, ownerUuid] },
        },
      });
      if (tags.length !== new Set(metadata.tagUuids).size) {
        throw new BadRequestException('One or more tags are not available');
      }
    }

    if (folderUuids) {
      const folders = await Folder.findAll({
        where: { uuid: { [Op.in]: folderUuids }, ownerUuid },
      });
      if (folders.length !== new Set(folderUuids).size) {
        throw new BadRequestException('One or more folders are not available');
      }
    }
  }

  private async previewDocument(document: Document, input: BulkMetadataInput, context: Context) {
    const snapshot = await this.snapshot(document.uuid, context.customDefinitions);
    const decision = this.decide(snapshot, document, input, context);
    return {
      documentUuid: document.uuid,
      title: document.title,
      applicableFields: decision.applicableFields,
      conflictingFields: decision.conflictingFields,
      canApply: decision.canApply,
      reason: decision.canApply ? null : 'All selected fields are already populated',
    };
  }

  private decide(
    snapshot: MetadataSnapshot,
    _document: Document,
    input: BulkMetadataInput,
    _context: Context,
  ) {
    const selected = this.selectedFields(input);
    const conflictingFields = selected.filter((field) => this.isPopulated(snapshot, field));
    let applicableFields = selected;
    if (input.policy === 'fill-empty') {
      applicableFields = selected.filter((field) => !conflictingFields.includes(field));
    }
    if (input.policy === 'skip-existing' && conflictingFields.length > 0) {
      applicableFields = [];
    }
    return {
      applicableFields,
      conflictingFields,
      canApply: applicableFields.length > 0,
    };
  }

  private selectedFields(input: BulkMetadataInput): string[] {
    const fields: string[] = [];
    const metadata = input.metadata;
    for (const field of [
      'issuerUuid',
      'documentTypeUuid',
      'categoryUuid',
      'tagUuids',
    ] as MetadataField[]) {
      if (Object.prototype.hasOwnProperty.call(metadata, field)) fields.push(field);
    }
    for (const key of Object.keys(metadata.custom ?? {})) fields.push(`custom.${key}`);
    if (input.folderUuids !== undefined) fields.push('folders');
    return fields;
  }

  private isPopulated(snapshot: MetadataSnapshot, field: string): boolean {
    if (field === 'issuerUuid') return snapshot.issuerUuid !== null;
    if (field === 'documentTypeUuid') return snapshot.documentTypeUuid !== null;
    if (field === 'categoryUuid') return snapshot.categoryUuid !== null;
    if (field === 'tagUuids') return snapshot.tagUuids.length > 0;
    if (field === 'folders') return snapshot.folderUuids.length > 0;
    if (field.startsWith('custom.')) {
      const value = snapshot.custom[field.slice('custom.'.length)];
      return value?.present === true && !this.isEmptyValue(value.value);
    }
    return false;
  }

  private async snapshot(
    documentUuid: string,
    customDefinitions: MetadataDefinition[],
    transaction?: Transaction,
  ): Promise<MetadataSnapshot> {
    const document = await Document.findByPk(documentUuid, { transaction });
    if (!document) throw new NotFoundException('Document not found');
    const [tagAssignments, folderLinks, values] = await Promise.all([
      DocumentTagAssignment.findAll({ where: { documentUuid }, transaction }),
      DocumentFolder.findAll({ where: { documentUuid }, transaction }),
      customDefinitions.length > 0
        ? DocumentMetadataValue.findAll({
            where: {
              documentUuid,
              definitionUuid: { [Op.in]: customDefinitions.map((definition) => definition.uuid) },
            },
            transaction,
          })
        : Promise.resolve([]),
    ]);
    const valuesByDefinition = new Map(values.map((value) => [value.definitionUuid, value]));
    const custom = Object.fromEntries(
      customDefinitions.map((definition) => {
        const value = valuesByDefinition.get(definition.uuid);
        return [definition.key, { present: Boolean(value), value: value?.value ?? null }];
      }),
    );
    return {
      issuerUuid: document.issuerUuid,
      documentTypeUuid: document.documentTypeUuid,
      categoryUuid: document.categoryUuid,
      tagUuids: tagAssignments.map((assignment) => assignment.tagUuid).sort(),
      folderUuids: folderLinks.map((link) => link.folderUuid).sort(),
      custom,
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  private async applyDecision(
    document: Document,
    input: BulkMetadataInput,
    fields: string[],
    context: Context,
    transaction: Transaction,
    revisionAt: Date,
  ): Promise<void> {
    const update: Record<string, unknown> = { updatedAt: revisionAt };
    const metadata = input.metadata;
    if (fields.includes('issuerUuid')) update.issuerUuid = metadata.issuerUuid;
    if (fields.includes('documentTypeUuid')) update.documentTypeUuid = metadata.documentTypeUuid;
    if (fields.includes('categoryUuid')) update.categoryUuid = metadata.categoryUuid;
    await document.update(update as never, { transaction });

    if (fields.includes('tagUuids')) {
      await DocumentTagAssignment.destroy({ where: { documentUuid: document.uuid }, transaction });
      if (metadata.tagUuids && metadata.tagUuids.length > 0) {
        await DocumentTagAssignment.bulkCreate(
          [...new Set(metadata.tagUuids)].map((tagUuid) => ({
            documentUuid: document.uuid,
            tagUuid,
          })),
          { transaction },
        );
      }
    }

    const customFields = fields
      .filter((field) => field.startsWith('custom.'))
      .map((field) => field.slice('custom.'.length));
    for (const key of customFields) {
      const definition = context.customDefinitions.find((item) => item.key === key);
      if (!definition) throw new BadRequestException(`Unknown metadata field '${key}'`);
      await DocumentMetadataValue.upsert(
        {
          documentUuid: document.uuid,
          definitionUuid: definition.uuid,
          value: metadata.custom?.[key],
        },
        { transaction },
      );
    }

    if (fields.includes('folders')) {
      await DocumentFolder.destroy({ where: { documentUuid: document.uuid }, transaction });
      if (input.folderUuids && input.folderUuids.length > 0) {
        await DocumentFolder.bulkCreate(
          [...new Set(input.folderUuids)].map((folderUuid) => ({
            documentUuid: document.uuid,
            folderUuid,
          })),
          { transaction },
        );
      }
    }
  }

  private async restoreSnapshot(
    document: Document,
    snapshot: MetadataSnapshot,
    customKeys: string[],
    transaction: Transaction,
    revisionAt: Date,
  ): Promise<void> {
    await document.update(
      {
        issuerUuid: snapshot.issuerUuid,
        documentTypeUuid: snapshot.documentTypeUuid,
        categoryUuid: snapshot.categoryUuid,
        updatedAt: revisionAt,
      } as never,
      { transaction },
    );

    await DocumentTagAssignment.destroy({ where: { documentUuid: document.uuid }, transaction });
    if (snapshot.tagUuids.length > 0) {
      await DocumentTagAssignment.bulkCreate(
        snapshot.tagUuids.map((tagUuid) => ({ documentUuid: document.uuid, tagUuid })),
        { transaction },
      );
    }

    const definitions = await MetadataDefinition.findAll({
      where: { key: { [Op.in]: customKeys } },
      transaction,
    });
    for (const definition of definitions) {
      const value = snapshot.custom[definition.key];
      if (!value?.present) {
        await DocumentMetadataValue.destroy({
          where: { documentUuid: document.uuid, definitionUuid: definition.uuid },
          transaction,
        });
        continue;
      }
      await DocumentMetadataValue.upsert(
        {
          documentUuid: document.uuid,
          definitionUuid: definition.uuid,
          value: value.value,
        },
        { transaction },
      );
    }

    await DocumentFolder.destroy({ where: { documentUuid: document.uuid }, transaction });
    if (snapshot.folderUuids.length > 0) {
      await DocumentFolder.bulkCreate(
        snapshot.folderUuids.map((folderUuid) => ({
          documentUuid: document.uuid,
          folderUuid,
        })),
        { transaction },
      );
    }
  }

  private validateCustomValue(definition: MetadataDefinition, value: unknown): void {
    if (value === null || value === undefined || value === '') {
      if (definition.mandatory) {
        throw new BadRequestException(`Metadata field '${definition.label}' is required`);
      }
      return;
    }
    if (definition.type === 'text' && typeof value !== 'string') {
      throw new BadRequestException(`Metadata field '${definition.label}' must be text`);
    }
    if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new BadRequestException(`Metadata field '${definition.label}' must be a number`);
    }
    if (
      definition.type === 'multi-select' &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    ) {
      throw new BadRequestException(`Metadata field '${definition.label}' must be a list`);
    }
    if (
      (definition.type === 'select' || definition.type === 'multi-select') &&
      definition.options
    ) {
      const values = Array.isArray(value) ? value : [value];
      if (values.some((item) => !definition.options?.includes(String(item)))) {
        throw new BadRequestException(`Metadata field '${definition.label}' has an invalid option`);
      }
    }
  }

  private async validateUniqueCustomValue(
    ownerUuid: string,
    documentUuids: string[],
    definition: MetadataDefinition,
    value: unknown,
  ): Promise<void> {
    if (!definition.unique || this.isEmptyValue(value)) return;

    if (documentUuids.length > 1) {
      throw new BadRequestException(`Metadata field '${definition.label}' must be unique`);
    }

    const existingValues = await DocumentMetadataValue.findAll({
      where: { definitionUuid: definition.uuid },
    });
    const usedByAnotherDocument = existingValues.some(
      (item) =>
        !documentUuids.includes(item.documentUuid) &&
        JSON.stringify(item.value) === JSON.stringify(value),
    );
    if (usedByAnotherDocument) {
      throw new BadRequestException(`Metadata field '${definition.label}' must be unique`);
    }
  }

  private isEmptyValue(value: unknown): boolean {
    return (
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  private changeSetResponse(changeSet: DocumentMetadataChangeSet): DocumentChangeSet {
    return DocumentChangeSetSchema.parse({
      uuid: changeSet.uuid,
      ownerUuid: changeSet.ownerUuid,
      actorUuid: changeSet.actorUuid,
      policy: changeSet.policy,
      status: changeSet.status,
      documentCount: changeSet.documentCount,
      createdAt: changeSet.createdAt.toISOString(),
      rolledBackAt: changeSet.rolledBackAt?.toISOString() ?? null,
      rolledBackBy: changeSet.rolledBackBy,
    });
  }
}

type Context = {
  documents: Document[];
  customDefinitions: MetadataDefinition[];
};
