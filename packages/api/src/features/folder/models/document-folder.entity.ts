import { Column, CreatedAt, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'document_folders', underscored: true, timestamps: false })
export class DocumentFolder extends Model {
  @PrimaryKey
  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @PrimaryKey
  @Column({ field: 'folder_id', type: DataType.UUID })
  declare folderUuid: string;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
