import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export interface DocumentShareAttributes {
  uuid: string;
  documentUuid: string;
  ownerUuid: string;
  recipientUserUuid: string;
  createdAt: Date;
}

export type DocumentShareCreationAttributes = Omit<
  DocumentShareAttributes,
  'uuid' | 'createdAt'
> & {
  uuid?: string;
};

@Table({ tableName: 'document_shares', underscored: true, timestamps: false })
export class DocumentShare extends Model<DocumentShareAttributes, DocumentShareCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'recipient_user_id', type: DataType.UUID, allowNull: false })
  declare recipientUserUuid: string;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;
}
