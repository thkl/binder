import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

@Table({ tableName: 'document_pages', underscored: true, timestamps: true })
export class DocumentPage extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'page_number', type: DataType.INTEGER, allowNull: true })
  declare pageNumber: number | null;

  @Column({ field: 'segment_index', type: DataType.INTEGER, allowNull: false })
  declare segmentIndex: number;

  @AllowNull(false)
  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: '' })
  declare text: string;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
