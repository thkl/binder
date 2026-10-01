import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { BulkMetadataPolicy, DocumentChangeSetStatus } from '@binder/common';

export interface DocumentMetadataChangeSetAttributes {
  uuid: string;
  ownerUuid: string;
  actorUuid: string | null;
  policy: BulkMetadataPolicy;
  status: DocumentChangeSetStatus;
  documentCount: number;
  changes: Record<string, unknown>[];
  createdAt: Date;
  rolledBackAt: Date | null;
  rolledBackBy: string | null;
}

export type DocumentMetadataChangeSetCreationAttributes = Omit<
  DocumentMetadataChangeSetAttributes,
  'uuid' | 'createdAt'
> & { uuid?: string };

@Table({ tableName: 'document_metadata_change_sets', underscored: true, timestamps: false })
export class DocumentMetadataChangeSet extends Model<
  DocumentMetadataChangeSetAttributes,
  DocumentMetadataChangeSetCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @AllowNull
  @Column({ field: 'actor_id', type: DataType.UUID, allowNull: true })
  declare actorUuid: string | null;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare policy: BulkMetadataPolicy;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'applied' })
  declare status: DocumentChangeSetStatus;

  @Column({ field: 'document_count', type: DataType.INTEGER, allowNull: false })
  declare documentCount: number;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  declare changes: Record<string, unknown>[];

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @AllowNull
  @Column({ field: 'rolled_back_at', type: DataType.DATE, allowNull: true })
  declare rolledBackAt: Date | null;

  @AllowNull
  @Column({ field: 'rolled_back_by', type: DataType.UUID, allowNull: true })
  declare rolledBackBy: string | null;
}
