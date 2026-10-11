import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export type PushNotificationEventType =
  'document-added' | 'processing-complete' | 'processing-failed';

export interface PushNotificationEventAttributes {
  uuid: string;
  ownerUuid: string;
  documentUuid: string;
  eventType: PushNotificationEventType;
  attempts: number;
  availableAt: Date;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

@Table({ tableName: 'push_notification_events', underscored: true, timestamps: false })
export class PushNotificationEvent extends Model<PushNotificationEventAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'event_type', type: DataType.STRING(32), allowNull: false })
  declare eventType: PushNotificationEventType;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({
    field: 'available_at',
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare availableAt: Date;

  @Column({ field: 'delivered_at', type: DataType.DATE, allowNull: true })
  declare deliveredAt: Date | null;

  @Column({ field: 'last_error', type: DataType.STRING(500), allowNull: true })
  declare lastError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;
}
