import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { MetadataWebhookDeliveryStatus } from '@binder/common';

export interface MetadataWebhookDeliveryAttributes {
  uuid: string;
  ownerUuid: string;
  documentUuid: string;
  sourceEventUuid: string;
  field: string;
  operator: string;
  triggerValue: string;
  payload: Record<string, unknown>;
  status: MetadataWebhookDeliveryStatus;
  attempts: number;
  availableAt: Date;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MetadataWebhookDeliveryCreationAttributes = Omit<
  MetadataWebhookDeliveryAttributes,
  'uuid' | 'createdAt' | 'updatedAt' | 'attempts' | 'status' | 'availableAt' | 'deliveredAt' | 'lastError'
>;

@Table({
  tableName: 'metadata_webhook_deliveries',
  underscored: true,
  timestamps: true,
  indexes: [{ name: 'metadata_webhook_deliveries_source_event_idx', unique: true, fields: ['source_event_id'] }],
})
export class MetadataWebhookDelivery extends Model<
  MetadataWebhookDeliveryAttributes,
  MetadataWebhookDeliveryCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'source_event_id', type: DataType.UUID, allowNull: false, unique: true })
  declare sourceEventUuid: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare field: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare operator: string;

  @Column({ field: 'trigger_value', type: DataType.STRING(500), allowNull: false, defaultValue: '' })
  declare triggerValue: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: Record<string, unknown>;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'pending' })
  declare status: MetadataWebhookDeliveryStatus;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: 'available_at', type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare availableAt: Date;

  @Column({ field: 'delivered_at', type: DataType.DATE, allowNull: true })
  declare deliveredAt: Date | null;

  @Column({ field: 'last_error', type: DataType.STRING(500), allowNull: true })
  declare lastError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
