import {
  AllowNull,
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
import { User } from '../../authentication/models/user.entity';

/** Approval lifecycle for a user-created metadata workflow. */
export type MetadataWebhookApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Persistent metadata rule and its protected outbound webhook configuration. */
@Table({
  tableName: 'metadata_webhook_workflows',
  underscored: true,
  timestamps: true,
  indexes: [
    { name: 'metadata_webhook_workflows_owner_created_idx', fields: ['owner_id', 'created_at'] },
    { name: 'metadata_webhook_workflows_approval_idx', fields: ['approval_status', 'created_at'] },
  ],
})
export class MetadataWebhookWorkflow extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @ForeignKey(() => User)
  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @BelongsTo(() => User, { foreignKey: 'ownerUuid', targetKey: 'uuid' })
  declare owner?: User;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare enabled: boolean;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare field: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare operator: string;

  @Column({ type: DataType.STRING(500), allowNull: false, defaultValue: '' })
  declare value: string;

  @Column({ type: DataType.STRING(2048), allowNull: false })
  declare url: string;

  @AllowNull
  @Column({ field: 'bearer_token', type: DataType.TEXT, allowNull: true })
  declare bearerToken: string | null;

  @AllowNull
  @Column({ field: 'bearer_token_iv', type: DataType.STRING(64), allowNull: true })
  declare bearerTokenIv: string | null;

  @Column({ field: 'payload_template', type: DataType.TEXT, allowNull: false })
  declare payloadTemplate: string;

  @Column({ field: 'approval_status', type: DataType.STRING(16), allowNull: false, defaultValue: 'pending' })
  declare approvalStatus: MetadataWebhookApprovalStatus;

  @AllowNull
  @ForeignKey(() => User)
  @Column({ field: 'reviewed_by', type: DataType.UUID, allowNull: true })
  declare reviewedBy: string | null;

  @AllowNull
  @Column({ field: 'reviewed_at', type: DataType.DATE, allowNull: true })
  declare reviewedAt: Date | null;

  @AllowNull
  @Column({ field: 'review_note', type: DataType.STRING(500), allowNull: true })
  declare reviewNote: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
