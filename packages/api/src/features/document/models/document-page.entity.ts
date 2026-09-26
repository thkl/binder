import {
  AllowNull,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt
} from 'sequelize-typescript';
import { Document } from './document.entity';

@Table({ tableName: 'document_pages', underscored: true, timestamps: true })
export class DocumentPage extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @ForeignKey(() => Document)
  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @BelongsTo(() => Document, { foreignKey: 'documentUuid' })
  declare document?: Document;

  @Column({ field: 'page_number', type: DataType.INTEGER, allowNull: false })
  declare pageNumber: number;

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
