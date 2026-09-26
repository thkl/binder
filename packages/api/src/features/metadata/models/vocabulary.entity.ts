import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export interface VocabularyAttributes {
  uuid: string;
  ownerUuid: string | null;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type VocabularyCreationAttributes = Omit<VocabularyAttributes, 'createdAt' | 'updatedAt'>;

abstract class VocabularyBase<T extends VocabularyAttributes = VocabularyAttributes> extends Model<T, VocabularyCreationAttributes> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @AllowNull @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string | null;

  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

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
