import { BelongsTo, Column, CreatedAt, DataType, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { Document } from './document.entity';

@Table({ tableName: 'document_embeddings', underscored: true, timestamps: true })
export class DocumentEmbedding extends Model {
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

  @Column({ field: 'chunk_index', type: DataType.INTEGER, allowNull: false })
  declare chunkIndex: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare content: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare embedding: number[];

  @Column({ field: 'embedding_vector', type: DataType.STRING, allowNull: false })
  declare embeddingVector: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare provider: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare model: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare dimensions: number;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
