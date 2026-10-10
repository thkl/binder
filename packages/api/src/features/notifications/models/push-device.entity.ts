import { Column, CreatedAt, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export interface PushDeviceAttributes {
  uuid: string;
  ownerUuid: string;
  token: string;
  deviceName: string;
  environment: 'sandbox' | 'production';
  createdAt: Date;
  updatedAt: Date;
}

export type PushDeviceCreationAttributes = Omit<PushDeviceAttributes, 'uuid' | 'createdAt' | 'updatedAt'>;

@Table({ tableName: 'push_devices', underscored: true, timestamps: true })
export class PushDevice extends Model<PushDeviceAttributes, PushDeviceCreationAttributes> {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING(200), allowNull: false, unique: true })
  declare token: string;

  @Column({ field: 'device_name', type: DataType.STRING(120), allowNull: false, defaultValue: 'iOS device' })
  declare deviceName: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare environment: 'sandbox' | 'production';

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
