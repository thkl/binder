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

export interface FolderAttributes {
  uuid: string;
  ownerUuid: string;
  parentUuid: string | null;
  name: string;
  sortPosition: number;
  createdAt: Date;
  updatedAt: Date;
}

export type FolderCreationAttributes = Omit<
  FolderAttributes,
  'createdAt' | 'updatedAt' | 'uuid' | 'sortPosition' | 'parentUuid'
> & {
  uuid?: string;
  parentUuid?: string | null;
  sortPosition?: number;
};

@Table({ tableName: 'folders', underscored: true, timestamps: true })
export class Folder extends Model<FolderAttributes, FolderCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @AllowNull
  @Column({ field: 'parent_id', type: DataType.UUID, allowNull: true })
  declare parentUuid: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare name: string;

  @Column({ field: 'sort_position', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare sortPosition: number;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
