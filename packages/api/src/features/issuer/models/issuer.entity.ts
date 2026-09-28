import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

export interface IssuerAttributes {
  uuid: string;
  ownerUuid: string;
  name: string;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  custom: Record<string, unknown>;
  folderUuid: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IssuerCreationAttributes = Omit<IssuerAttributes, 'createdAt' | 'updatedAt' | 'uuid'> & { uuid?: string };

@Table({ tableName: 'issuers', underscored: true, timestamps: true })
export class Issuer extends Model<IssuerAttributes, IssuerCreationAttributes> {
  @PrimaryKey @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @AllowNull @Column({ type: DataType.STRING(255), allowNull: true })
  declare address: string | null;

  @AllowNull @Column({ field: 'zip_code', type: DataType.STRING(32), allowNull: true })
  declare zipCode: string | null;

  @AllowNull @Column({ type: DataType.STRING(150), allowNull: true })
  declare city: string | null;

  @AllowNull @Column({ type: DataType.STRING(100), allowNull: true })
  declare country: string | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare custom: Record<string, unknown>;

  @AllowNull @Column({ field: 'folder_id', type: DataType.UUID, allowNull: true })
  declare folderUuid: string | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare readonly createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare readonly updatedAt: Date;
}
