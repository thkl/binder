import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { LocalizedText } from '@binder/common';

export interface VocabularyAttributes {
  uuid: string;
  ownerUuid: string | null;
  name: string;
  translations: LocalizedText;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type VocabularyCreationAttributes = Omit<VocabularyAttributes, 'createdAt' | 'updatedAt'>;

export type MetadataFieldType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'select' | 'multi-select';

abstract class VocabularyBase<T extends VocabularyAttributes = VocabularyAttributes> extends Model<T, VocabularyCreationAttributes> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @AllowNull @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string | null;

  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare translations: LocalizedText;

  @AllowNull @Column({ type: DataType.STRING(500) })
  declare description: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare active: boolean;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}

@Table({ tableName: 'document_types', underscored: true, timestamps: true })
export class DocumentType extends VocabularyBase {}

@Table({ tableName: 'document_categories', underscored: true, timestamps: true })
export class DocumentCategory extends VocabularyBase {
  @AllowNull @Column({ field: 'parent_id', type: DataType.UUID })
  declare parentUuid: string | null;
}

@Table({ tableName: 'document_tags', underscored: true, timestamps: true })
export class DocumentTag extends VocabularyBase {}

@Table({ tableName: 'document_tag_assignments', underscored: true, timestamps: false })
export class DocumentTagAssignment extends Model {
  @PrimaryKey @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @PrimaryKey @Column({ field: 'tag_id', type: DataType.UUID })
  declare tagUuid: string;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}

@Table({ tableName: 'metadata_definitions', underscored: true, timestamps: true })
export class MetadataDefinition extends Model {
  @PrimaryKey @Default(DataType.UUIDV4) @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @AllowNull @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare key: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  declare label: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare type: MetadataFieldType;

  @AllowNull @Column({ type: DataType.JSONB })
  declare options: string[] | null;

  @Column({ field: 'is_unique', type: DataType.BOOLEAN, defaultValue: false })
  declare unique: boolean;

  @Column({ field: 'is_mandatory', type: DataType.BOOLEAN, defaultValue: false })
  declare mandatory: boolean;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  declare active: boolean;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}

@Table({ tableName: 'document_metadata_values', underscored: true, timestamps: true })
export class DocumentMetadataValue extends Model {
  @PrimaryKey @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @PrimaryKey @Column({ field: 'definition_id', type: DataType.UUID })
  declare definitionUuid: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare value: unknown;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
