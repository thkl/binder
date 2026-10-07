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
  UpdatedAt,
} from 'sequelize-typescript';

export type JobKind =
  'malware-scan' | 'thumbnail' | 'text-extraction' | 'ocr' | 'embedding' | 'pdfa';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type DocumentStatus =
  'uploaded' | 'scanning' | 'processing' | 'ready' | 'failed' | 'quarantined';
export type DocumentArchiveStatus = 'not-requested' | 'queued' | 'processing' | 'ready' | 'failed';

export type DocumentAuditActorType = 'user' | 'worker' | 'system';
export type DocumentAuditEventType =
  | 'uploaded'
  | 'title-changed'
  | 'metadata-changed'
  | 'folder-added'
  | 'folder-removed'
  | 'ai-suggestion-generated'
  | 'ai-suggestion-applied'
  | 'ai-suggestion-cleared'
  | 'requeued'
  | 'archive-queued'
  | 'archive-generated'
  | 'archive-failed'
  | 'downloaded'
  | 'exported'
  | 'processing-started'
  | 'processing-succeeded'
  | 'processing-failed'
  | 'quarantined';

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

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare description: string | null;
}

@Table({ tableName: 'email_import_configs', underscored: true, timestamps: true })
export class EmailImportConfig extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ type: DataType.BOOLEAN }) declare enabled: boolean;
  @Column({ type: DataType.STRING(255) }) declare host: string;
  @Column({ type: DataType.INTEGER }) declare port: number;
  @Column({ type: DataType.BOOLEAN }) declare secure: boolean;
  @Column({ type: DataType.STRING(320) }) declare username: string;
  @Column({ type: DataType.TEXT, allowNull: true }) declare password: string | null;
  @Column({ field: 'password_iv', type: DataType.STRING(32), allowNull: true })
  declare passwordIv: string | null;
  @Column({ type: DataType.STRING(255) }) declare mailbox: string;
  @Column({ field: 'poll_interval_ms', type: DataType.INTEGER }) declare pollIntervalMs: number;
  @Column({ field: 'delete_after_import', type: DataType.BOOLEAN })
  declare deleteAfterImport: boolean;
  @Column({ field: 'trusted_senders', type: DataType.JSONB }) declare trustedSenders: string[];
  @Column({ field: 'last_polled_at', type: DataType.DATE, allowNull: true })
  declare lastPolledAt: Date | null;
  @Column({ field: 'last_uid_validity', type: DataType.STRING(40), allowNull: true })
  declare lastUidValidity: string | null;
  @Column({ field: 'last_message_uid', type: DataType.STRING(40), allowNull: true })
  declare lastMessageUid: string | null;
  @Column({ field: 'last_error', type: DataType.TEXT, allowNull: true })
  declare lastError: string | null;
  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'pipeline_worker_heartbeats', underscored: true, timestamps: false })
export class PipelineWorkerHeartbeat extends Model {
  @PrimaryKey
  @Column({ field: 'worker_id', type: DataType.STRING(255) })
  declare workerId: string;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date;

  @Column({ type: DataType.STRING(100) })
  declare version: string;

  @Column({ type: DataType.JSONB })
  declare capabilities: Record<string, unknown>;
}

@Table({ tableName: 'calendar_events', underscored: true, timestamps: true })
export class CalendarEvent extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ field: 'event_uid', type: DataType.STRING(255) })
  declare eventUid: string;

  @Column({ field: 'due_date', type: DataType.DATEONLY })
  declare dueDate: string;

  @Column({ type: DataType.STRING(255) })
  declare title: string;

  @Column({ type: DataType.STRING(2000) })
  declare description: string;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'ai_provider_profiles', underscored: true, timestamps: true })
export class AiProviderProfile extends Model {
  @PrimaryKey
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ type: DataType.STRING(100) })
  declare name: string;

  @Column({ field: 'provider_type', type: DataType.STRING(64) })
  declare providerType: 'openai-compatible';

  @Column({ field: 'assistant_endpoint', type: DataType.STRING(500), allowNull: true })
  declare assistantEndpoint: string | null;

  @Column({ field: 'assistant_model', type: DataType.STRING(150), allowNull: true })
  declare assistantModel: string | null;

  @Column({ field: 'embedding_endpoint', type: DataType.STRING(500), allowNull: true })
  declare embeddingEndpoint: string | null;

  @Column({ field: 'embedding_model', type: DataType.STRING(150), allowNull: true })
  declare embeddingModel: string | null;

  @Column({ field: 'api_key', type: DataType.TEXT })
  declare apiKey: string;

  @Column({ field: 'api_key_iv', type: DataType.STRING(32), allowNull: true })
  declare apiKeyIv: string | null;

  @Column({ type: DataType.BOOLEAN })
  declare enabled: boolean;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'maintenance_runs', underscored: true, timestamps: true })
export class MaintenanceRun extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'job_key', type: DataType.STRING(64) })
  declare jobKey: 'backup' | 'backup-retention' | 'storage-consistency' | 'restore';

  @Column({ type: DataType.STRING(32) })
  declare status: 'running' | 'succeeded' | 'failed';

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date;

  @Column({ field: 'finished_at', type: DataType.DATE, allowNull: true })
  declare finishedAt: Date | null;

  @Column({ field: 'next_run_at', type: DataType.DATE, allowNull: true })
  declare nextRunAt: Date | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER, allowNull: true })
  declare durationMs: number | null;

  @Column({ field: 'artifact_name', type: DataType.STRING(255), allowNull: true })
  declare artifactName: string | null;

  @Column({ field: 'size_bytes', type: DataType.BIGINT, allowNull: true })
  declare sizeBytes: number | null;

  @Column({ field: 'deleted_files', type: DataType.INTEGER, allowNull: true })
  declare deletedFiles: number | null;

  @Column({ field: 'checked_files', type: DataType.INTEGER, allowNull: true })
  declare checkedFiles: number | null;

  @Column({ field: 'issue_count', type: DataType.INTEGER, allowNull: true })
  declare issueCount: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare error: string | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  declare progress: Array<{ at: string; level: 'info' | 'error' | 'warning'; message: string }>;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

export type DocumentStorageIssueType =
  'missing' | 'size-mismatch' | 'checksum-mismatch' | 'unreadable';

@Table({ tableName: 'document_storage_issues', underscored: true, timestamps: true })
export class DocumentStorageIssue extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @Column({ field: 'issue_type', type: DataType.STRING(32) })
  declare issueType: DocumentStorageIssueType;

  @Column({ type: DataType.STRING(16) })
  declare status: 'open' | 'resolved';

  @Column({ field: 'expected_size_bytes', type: DataType.BIGINT })
  declare expectedSizeBytes: number;

  @Column({ field: 'actual_size_bytes', type: DataType.BIGINT, allowNull: true })
  declare actualSizeBytes: number | null;

  @Column({ field: 'expected_checksum_sha256', type: DataType.STRING(64) })
  declare expectedChecksumSha256: string;

  @Column({ field: 'actual_checksum_sha256', type: DataType.STRING(64), allowNull: true })
  declare actualChecksumSha256: string | null;

  @Column({ type: DataType.STRING(1000) })
  declare details: string;

  @Column({ field: 'first_detected_at', type: DataType.DATE })
  declare firstDetectedAt: Date;

  @Column({ field: 'last_detected_at', type: DataType.DATE })
  declare lastDetectedAt: Date;

  @Column({ field: 'resolved_at', type: DataType.DATE, allowNull: true })
  declare resolvedAt: Date | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'maintenance_requests', underscored: true, timestamps: true })
export class MaintenanceRequest extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'job_key', type: DataType.STRING(64) })
  declare jobKey: 'backup' | 'restore';

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare payload: Record<string, string>;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
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
  @PrimaryKey
  @Default(DataType.UUIDV4)
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

  @Column({ field: 'folder_id', type: DataType.UUID, allowNull: true })
  declare folderUuid: string | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

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

@Table({ tableName: 'document_audit_events', underscored: true, timestamps: false })
export class DocumentAuditEvent extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID })
  declare ownerUuid: string;

  @Column({ field: 'actor_id', type: DataType.UUID, allowNull: true })
  declare actorUuid: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(16) })
  declare actorType: DocumentAuditActorType;

  @Column({ field: 'event_type', type: DataType.STRING(64) })
  declare eventType: DocumentAuditEventType;

  @Column({ type: DataType.STRING(500) })
  declare summary: string;

  @Column({ type: DataType.JSONB })
  declare details: Record<string, unknown>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}

export type InboxItemStatus =
  'new' | 'processing' | 'imported' | 'duplicate' | 'rejected' | 'failed';
export type InboxAiStatus = 'pending' | 'processing' | 'ready' | 'failed';

@Table({ tableName: 'inbox_items', underscored: true, timestamps: true })
export class InboxItem extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
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

  @Column({ field: 'archive_key', type: DataType.STRING, allowNull: true })
  declare archiveKey: string | null;

  @Column({
    field: 'archive_status',
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: 'not-requested',
  })
  declare archiveStatus: DocumentArchiveStatus;

  @Column({ field: 'archive_error', type: DataType.STRING(2000), allowNull: true })
  declare archiveError: string | null;

  @Column({ field: 'page_count', type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare pageCount: number;

  @Column({ field: 'issuer_id', type: DataType.UUID, allowNull: true })
  declare issuerUuid: string | null;

  @Column({ field: 'is_new', type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isNew: boolean;

  @Column({ field: 'ai_suggestion', type: DataType.JSONB, allowNull: true })
  declare aiSuggestion: Record<string, unknown> | null;

  @Column({ type: DataType.STRING })
  declare status: DocumentStatus;
}

@Table({ tableName: 'document_embeddings', underscored: true, timestamps: true })
export class DocumentEmbedding extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
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
