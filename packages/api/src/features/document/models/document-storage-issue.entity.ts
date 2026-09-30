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

export type DocumentStorageIssueType =
  | 'missing'
  | 'size-mismatch'
  | 'checksum-mismatch'
  | 'unreadable';
export type DocumentStorageIssueStatus = 'open' | 'resolved';

@Table({ tableName: 'document_storage_issues', underscored: true, timestamps: true })
export class DocumentStorageIssue extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'issue_type', type: DataType.STRING(32), allowNull: false })
  declare issueType: DocumentStorageIssueType;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare status: DocumentStorageIssueStatus;

  @Column({ field: 'expected_size_bytes', type: DataType.BIGINT, allowNull: false })
  declare expectedSizeBytes: number;

  @AllowNull
  @Column({ field: 'actual_size_bytes', type: DataType.BIGINT })
  declare actualSizeBytes: number | null;

  @Column({ field: 'expected_checksum_sha256', type: DataType.STRING(64), allowNull: false })
  declare expectedChecksumSha256: string;

  @AllowNull
  @Column({ field: 'actual_checksum_sha256', type: DataType.STRING(64) })
  declare actualChecksumSha256: string | null;

  @Column({ type: DataType.STRING(1000), allowNull: false })
  declare details: string;

  @Column({ field: 'first_detected_at', type: DataType.DATE, allowNull: false })
  declare firstDetectedAt: Date;

  @Column({ field: 'last_detected_at', type: DataType.DATE, allowNull: false })
  declare lastDetectedAt: Date;

  @AllowNull
  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
