import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

export interface FolderShareAttributes {
  uuid: string;
  folderUuid: string;
  ownerUuid: string;
  recipientUserUuid: string;
  createdAt: Date;
}

export type FolderShareCreationAttributes = Omit<FolderShareAttributes, 'uuid' | 'createdAt'> & {
  uuid?: string;
};

@Table({ tableName: 'folder_shares', underscored: true, timestamps: false })
export class FolderShare extends Model<FolderShareAttributes, FolderShareCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'folder_id', type: DataType.UUID, allowNull: false })
  declare folderUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'recipient_user_id', type: DataType.UUID, allowNull: false })
  declare recipientUserUuid: string;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;
}
