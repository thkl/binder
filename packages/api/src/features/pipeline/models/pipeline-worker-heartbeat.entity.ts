import { AllowNull, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'pipeline_worker_heartbeats', underscored: true, timestamps: false })
export class PipelineWorkerHeartbeat extends Model {
  @PrimaryKey
  @Column({ field: 'worker_id', type: DataType.STRING(255) })
  declare workerId: string;

  @Column({ field: 'last_seen_at', type: DataType.DATE, allowNull: false })
  declare lastSeenAt: Date;

  @Column({ field: 'started_at', type: DataType.DATE, allowNull: false })
  declare startedAt: Date;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare version: string;

  @AllowNull(false)
  @Column({ type: DataType.JSONB, defaultValue: {} })
  declare capabilities: Record<string, unknown>;
}
