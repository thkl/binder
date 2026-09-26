import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt
} from 'sequelize-typescript';

export type JobKind = 'thumbnail' | 'text-extraction' | 'ocr' | 'embedding';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type DocumentStatus = 'uploaded' | 'scanning' | 'processing' | 'ready' | 'failed';

@Table({ tableName: 'settings', timestamps: false })
export class ApplicationSetting extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(255) })
  declare key: string;

  @Column({ type: DataType.TEXT })
  declare value: string;

  @Column({ field: 'is_encrypted', type: DataType.BOOLEAN })
  declare isEncrypted: boolean;

  @Column({ field: 'value_iv', type: DataType.STRING(32), allowNull: true })
  declare valueIv: string | null;
}

@Table({ tableName: 'documents', underscored: true, timestamps: true })
export class Document extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'storage_key', type: DataType.STRING })
  declare storageKey: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ field: 'thumbnail_key', type: DataType.STRING, allowNull: true })
  declare thumbnailKey: string | null;

  @Column({ type: DataType.STRING })
  declare status: DocumentStatus;
}

@Table({ tableName: 'document_embeddings', underscored: true, timestamps: true })
export class DocumentEmbedding extends Model {
  @PrimaryKey @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;
  @ForeignKey(() => Document)
  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;
  @Column({ field: 'page_number', type: DataType.INTEGER }) declare pageNumber: number;
  @Column({ field: 'chunk_index', type: DataType.INTEGER }) declare chunkIndex: number;
  @Column({ type: DataType.TEXT }) declare content: string;
  @Column({ type: DataType.JSONB }) declare embedding: number[];
  @Column({ type: DataType.STRING(100) }) declare provider: string;
  @Column({ type: DataType.STRING(200) }) declare model: string;
  @Column({ type: DataType.INTEGER }) declare dimensions: number;
  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'pipeline_jobs', underscored: true, timestamps: true })
export class PipelineJob extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @ForeignKey(() => Document)
  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @BelongsTo(() => Document, { foreignKey: 'documentUuid' })
  declare document?: Document;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING })
  declare kind: JobKind;

  @Column({ type: DataType.STRING })
  declare status: JobStatus;

  @Column({ type: DataType.INTEGER })
  declare attempts: number;

  @Column({ field: 'max_attempts', type: DataType.INTEGER })
  declare maxAttempts: number;

  @Column({ field: 'available_at', type: DataType.DATE })
  declare availableAt: Date;

  @Column({ field: 'locked_at', type: DataType.DATE, allowNull: true })
  declare lockedAt: Date | null;

  @Column({ field: 'locked_by', type: DataType.STRING, allowNull: true })
  declare lockedBy: string | null;

  @Column({ field: 'started_at', type: DataType.DATE, allowNull: true })
  declare startedAt: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE, allowNull: true })
  declare completedAt: Date | null;

  @Column({ field: 'last_error', type: DataType.STRING, allowNull: true })
  declare lastError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;

}

@Table({ tableName: 'pipeline_job_events', underscored: true, timestamps: false })
export class PipelineJobEvent extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @ForeignKey(() => PipelineJob)
  @Column({ field: 'job_id', type: DataType.UUID })
  declare jobUuid: string;

  @Column({ type: DataType.STRING })
  declare type: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare message: string | null;

  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
