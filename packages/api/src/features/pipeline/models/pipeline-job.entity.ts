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

export type PipelineJobKind =
  | 'malware-scan'
  | 'thumbnail'
  | 'text-extraction'
  | 'ocr'
  | 'embedding'
  | 'pdfa';
export type PipelineJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PipelineJobAttributes {
  uuid: string;
  documentUuid: string;
  ownerUuid: string;
  kind: PipelineJobKind;
  status: PipelineJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PipelineJobCreationAttributes = Omit<
  PipelineJobAttributes,
  | 'createdAt'
  | 'updatedAt'
  | 'uuid'
  | 'status'
  | 'attempts'
  | 'maxAttempts'
  | 'availableAt'
  | 'lockedAt'
  | 'lockedBy'
  | 'startedAt'
  | 'completedAt'
  | 'lastError'
> & {
  uuid?: string;
  status?: PipelineJobStatus;
  attempts?: number;
  maxAttempts?: number;
  availableAt?: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastError?: string | null;
};

@Table({ tableName: 'pipeline_jobs', underscored: true, timestamps: true })
export class PipelineJob extends Model<PipelineJobAttributes, PipelineJobCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare kind: PipelineJobKind;

  @Column({
    type: DataType.ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled'),
    allowNull: false,
    defaultValue: 'queued',
  })
  declare status: PipelineJobStatus;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: 'max_attempts', type: DataType.INTEGER, allowNull: false, defaultValue: 3 })
  declare maxAttempts: number;

  @Column({
    field: 'available_at',
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare availableAt: Date;

  @AllowNull
  @Column({ field: 'locked_at', type: DataType.DATE })
  declare lockedAt: Date | null;

  @AllowNull
  @Column({ field: 'locked_by', type: DataType.STRING(255) })
  declare lockedBy: string | null;

  @AllowNull
  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @AllowNull
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @AllowNull
  @Column({ field: 'last_error', type: DataType.STRING(2000) })
  declare lastError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
