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

export interface CalendarEventAttributes {
  uuid: string;
  documentUuid: string;
  ownerUuid: string;
  eventUid: string;
  dueDate: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CalendarEventCreationAttributes = Omit<
  CalendarEventAttributes,
  'createdAt' | 'updatedAt' | 'uuid'
> & { uuid?: string };

@Table({ tableName: 'calendar_events', underscored: true, timestamps: true })
export class CalendarEvent extends Model<CalendarEventAttributes, CalendarEventCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'event_uid', type: DataType.STRING(255), allowNull: false })
  declare eventUid: string;

  @Column({ field: 'due_date', type: DataType.DATEONLY, allowNull: false })
  declare dueDate: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare title: string;

  @Column({ type: DataType.STRING(2000), allowNull: false, defaultValue: '' })
  declare description: string;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
