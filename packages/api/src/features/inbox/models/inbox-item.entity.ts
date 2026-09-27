import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt
} from 'sequelize-typescript';

export type InboxItemStatus = 'new' | 'processing' | 'imported' | 'duplicate' | 'rejected' | 'failed';
export type InboxAiStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface InboxItemAttributes {
  uuid: string;
  ownerUuid: string;
  documentUuid: string | null;
  originalFilename: string;
  checksumSha256: string | null;
  sizeBytes: number;
  status: InboxItemStatus;
  aiStatus: InboxAiStatus;
  aiSuggestion: Record<string, unknown> | null;
  lastError: string | null;
  aiError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InboxItemCreationAttributes = Omit<InboxItemAttributes, 'createdAt' | 'updatedAt' | 'uuid' | 'status' | 'aiStatus' | 'documentUuid' | 'checksumSha256' | 'aiSuggestion' | 'lastError' | 'aiError'> & {
  uuid?: string;
  documentUuid?: string | null;
  checksumSha256?: string | null;
  status?: InboxItemStatus;
  aiStatus?: InboxAiStatus;
  aiSuggestion?: Record<string, unknown> | null;
  lastError?: string | null;
  aiError?: string | null;
};

@Table({ tableName: 'inbox_items', underscored: true, timestamps: true })
export class InboxItem extends Model<InboxItemAttributes, InboxItemCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @AllowNull
  @Column({ field: 'document_id', type: DataType.UUID, allowNull: true })
  declare documentUuid: string | null;

  @Column({ field: 'original_filename', type: DataType.STRING(255), allowNull: false })
  declare originalFilename: string;

  @AllowNull
  @Column({ field: 'checksum_sha256', type: DataType.STRING(64), allowNull: true })
  declare checksumSha256: string | null;

  @Column({ field: 'size_bytes', type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  declare sizeBytes: number;

  @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'new' })
  declare status: InboxItemStatus;

  @Column({ field: 'ai_status', type: DataType.STRING(32), allowNull: false, defaultValue: 'pending' })
  declare aiStatus: InboxAiStatus;

  @AllowNull
  @Column({ field: 'ai_suggestion', type: DataType.JSONB, allowNull: true })
  declare aiSuggestion: Record<string, unknown> | null;

  @AllowNull
  @Column({ field: 'last_error', type: DataType.STRING(2000), allowNull: true })
  declare lastError: string | null;

  @AllowNull
  @Column({ field: 'ai_error', type: DataType.STRING(2000), allowNull: true })
  declare aiError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
