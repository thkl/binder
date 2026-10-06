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

export type DocumentStatus =
  'uploaded' | 'scanning' | 'processing' | 'ready' | 'failed' | 'quarantined';
export type DocumentArchiveStatus = 'not-requested' | 'queued' | 'processing' | 'ready' | 'failed';

export interface DocumentAttributes {
  uuid: string;
  ownerUuid: string;
  title: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageKey: string;
  thumbnailKey: string | null;
  archiveKey: string | null;
  archiveStatus: DocumentArchiveStatus;
  archiveError: string | null;
  pageCount: number;
  issuerUuid: string | null;
  isNew: boolean;
  aiSuggestion: Record<string, unknown> | null;
  searchVector: unknown;
  status: DocumentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentCreationAttributes = Omit<
  DocumentAttributes,
  | 'createdAt'
  | 'updatedAt'
  | 'uuid'
  | 'status'
  | 'thumbnailKey'
  | 'archiveKey'
  | 'archiveStatus'
  | 'archiveError'
  | 'pageCount'
  | 'issuerUuid'
  | 'isNew'
  | 'aiSuggestion'
> & {
  uuid?: string;
  thumbnailKey?: string | null;
  archiveKey?: string | null;
  archiveStatus?: DocumentArchiveStatus;
  archiveError?: string | null;
  pageCount?: number;
  issuerUuid?: string | null;
  isNew?: boolean;
  aiSuggestion?: Record<string, unknown> | null;
  status?: DocumentStatus;
};

@Table({ tableName: 'documents', underscored: true, timestamps: true })
export class Document extends Model<DocumentAttributes, DocumentCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'original_filename', type: DataType.STRING(255), allowNull: false })
  declare originalFilename: string;

  @AllowNull
  @Column({ type: DataType.STRING(255), allowNull: true })
  declare title: string | null;

  @Column({ field: 'mime_type', type: DataType.STRING(100), allowNull: false })
  declare mimeType: string;

  @Column({ field: 'size_bytes', type: DataType.BIGINT, allowNull: false })
  declare sizeBytes: number;

  @Column({ field: 'checksum_sha256', type: DataType.STRING(64), allowNull: false })
  declare checksumSha256: string;

  @Column({ field: 'storage_key', type: DataType.STRING(500), allowNull: false })
  declare storageKey: string;

  @AllowNull
  @Column({ field: 'thumbnail_key', type: DataType.STRING(500), allowNull: true })
  declare thumbnailKey: string | null;

  @AllowNull
  @Column({ field: 'archive_key', type: DataType.STRING(500), allowNull: true })
  declare archiveKey: string | null;

  @Column({
    field: 'archive_status',
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: 'not-requested',
  })
  declare archiveStatus: DocumentArchiveStatus;

  @AllowNull
  @Column({ field: 'archive_error', type: DataType.STRING(2000), allowNull: true })
  declare archiveError: string | null;

  @Column({ field: 'page_count', type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare pageCount: number;

  @AllowNull
  @Column({ field: 'document_type_id', type: DataType.UUID })
  declare documentTypeUuid: string | null;

  @AllowNull
  @Column({ field: 'category_id', type: DataType.UUID })
  declare categoryUuid: string | null;

  @AllowNull
  @Column({ field: 'issuer_id', type: DataType.UUID })
  declare issuerUuid: string | null;

  @Column({ field: 'is_new', type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isNew: boolean;

  @AllowNull
  @Column({ field: 'ai_suggestion', type: DataType.JSONB, allowNull: true })
  declare aiSuggestion: Record<string, unknown> | null;

  @Column({ field: 'search_vector', type: DataType.TSVECTOR })
  declare searchVector: unknown;

  @Column({
    type: DataType.ENUM('uploaded', 'scanning', 'processing', 'ready', 'failed', 'quarantined'),
    allowNull: false,
    defaultValue: 'uploaded',
  })
  declare status: DocumentStatus;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
