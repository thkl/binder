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
import type { DocumentAuditActorType, DocumentAuditEventType } from '@binder/common';

export interface DocumentAuditEventAttributes {
  uuid: string;
  documentUuid: string;
  ownerUuid: string;
  actorUuid: string | null;
  actorType: DocumentAuditActorType;
  eventType: DocumentAuditEventType;
  summary: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export type DocumentAuditEventCreationAttributes = Omit<
  DocumentAuditEventAttributes,
  'uuid' | 'createdAt'
> & { uuid?: string };

@Table({ tableName: 'document_audit_events', underscored: true, timestamps: false })
export class DocumentAuditEventEntity extends Model<
  DocumentAuditEventAttributes,
  DocumentAuditEventCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @AllowNull
  @Column({ field: 'actor_id', type: DataType.UUID, allowNull: true })
  declare actorUuid: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(16), allowNull: false })
  declare actorType: DocumentAuditActorType;

  @Column({ field: 'event_type', type: DataType.STRING(64), allowNull: false })
  declare eventType: DocumentAuditEventType;

  @Column({ type: DataType.STRING(500), allowNull: false })
  declare summary: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare details: Record<string, unknown>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;
}
