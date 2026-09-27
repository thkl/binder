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

@Table({ tableName: 'users', timestamps: false })
export class User extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;
}

@Table({ tableName: 'issuers', underscored: true, timestamps: true })
export class Issuer extends Model {
  @PrimaryKey @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING(200) })
  declare name: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare address: string | null;

  @Column({ field: 'zip_code', type: DataType.STRING(32), allowNull: true })
  declare zipCode: string | null;

  @Column({ type: DataType.STRING(150), allowNull: true })
  declare city: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare country: string | null;

  @Column({ type: DataType.JSONB })
  declare custom: Record<string, unknown>;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

export type InboxItemStatus = 'new' | 'processing' | 'imported' | 'duplicate' | 'rejected' | 'failed';
export type InboxAiStatus = 'pending' | 'processing' | 'ready' | 'failed';

@Table({ tableName: 'inbox_items', underscored: true, timestamps: true })
export class InboxItem extends Model {
  @PrimaryKey @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: true })
  declare documentUuid: string | null;

  @Column({ field: 'original_filename', type: DataType.STRING(255) })
  declare originalFilename: string;

  @Column({ field: 'checksum_sha256', type: DataType.STRING(64), allowNull: true })
  declare checksumSha256: string | null;

  @Column({ field: 'size_bytes', type: DataType.BIGINT })
  declare sizeBytes: number;

  @Column({ type: DataType.STRING(32) })
  declare status: InboxItemStatus;

  @Column({ field: 'ai_status', type: DataType.STRING(32) })
  declare aiStatus: InboxAiStatus;

  @Column({ field: 'ai_suggestion', type: DataType.JSONB, allowNull: true })
  declare aiSuggestion: Record<string, unknown> | null;

  @Column({ field: 'ai_auto_applied', type: DataType.BOOLEAN })
  declare autoApplied: boolean;

  @Column({ field: 'last_error', type: DataType.STRING(2000), allowNull: true })
  declare lastError: string | null;

  @Column({ field: 'ai_error', type: DataType.STRING(2000), allowNull: true })
  declare aiError: string | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
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

  @Column({ field: 'original_filename', type: DataType.STRING(255) })
  declare originalFilename: string;

  @Column({ type: DataType.STRING(255) })
  declare title: string | null;

  @Column({ field: 'mime_type', type: DataType.STRING(100) })
  declare mimeType: string;

  @Column({ field: 'size_bytes', type: DataType.BIGINT })
  declare sizeBytes: number;

  @Column({ field: 'checksum_sha256', type: DataType.STRING(64) })
  declare checksumSha256: string;

  @Column({ field: 'thumbnail_key', type: DataType.STRING, allowNull: true })
  declare thumbnailKey: string | null;

  @Column({ field: 'issuer_id', type: DataType.UUID, allowNull: true })
  declare issuerUuid: string | null;

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
  // Sequelize has no built-in pgvector type; this maps the existing database
  // column as a string while PostgreSQL validates the native vector value.
  @Column({ field: 'embedding_vector', type: DataType.STRING }) declare embeddingVector: string;
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
