import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { ClassificationFeedbackField } from '@binder/common';

export interface DocumentClassificationFeedbackAttributes {
  uuid: string;
  ownerUuid: string;
  sourceDocumentUuid: string | null;
  fingerprint: string;
  field: ClassificationFeedbackField;
  valueUuid: string;
  previousValueUuid: string | null;
  matchCount: number;
  active: boolean;
  lastMatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentClassificationFeedbackCreationAttributes = Omit<
  DocumentClassificationFeedbackAttributes,
  'uuid' | 'createdAt' | 'updatedAt'
> & { uuid?: string };

@Table({ tableName: 'document_classification_feedback', underscored: true, timestamps: true })
export class DocumentClassificationFeedback extends Model<
  DocumentClassificationFeedbackAttributes,
  DocumentClassificationFeedbackCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @AllowNull
  @Column({ field: 'source_document_id', type: DataType.UUID, allowNull: true })
  declare sourceDocumentUuid: string | null;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare fingerprint: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare field: ClassificationFeedbackField;

  @Column({ field: 'value_id', type: DataType.UUID, allowNull: false })
  declare valueUuid: string;

  @AllowNull
  @Column({ field: 'previous_value_id', type: DataType.UUID, allowNull: true })
  declare previousValueUuid: string | null;

  @Column({ field: 'match_count', type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare matchCount: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare active: boolean;

  @AllowNull
  @Column({ field: 'last_matched_at', type: DataType.DATE, allowNull: true })
  declare lastMatchedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
