import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { MaintenanceJob, MaintenanceRunStatus } from '@binder/common';

@Table({ tableName: 'maintenance_runs', underscored: true, timestamps: true })
export class MaintenanceRun extends Model {
  @PrimaryKey @Default(DataType.UUIDV4) @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'job_key', type: DataType.STRING(64), allowNull: false })
  declare jobKey: MaintenanceJob;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare status: MaintenanceRunStatus;

  @Column({ field: 'started_at', type: DataType.DATE, allowNull: false })
  declare startedAt: Date;

  @AllowNull @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @AllowNull @Column({ field: 'next_run_at', type: DataType.DATE })
  declare nextRunAt: Date | null;

  @AllowNull @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @AllowNull @Column({ field: 'artifact_name', type: DataType.STRING(255) })
  declare artifactName: string | null;

  @AllowNull @Column({ field: 'size_bytes', type: DataType.BIGINT })
  declare sizeBytes: number | null;

  @AllowNull @Column({ field: 'deleted_files', type: DataType.INTEGER })
  declare deletedFiles: number | null;

  @AllowNull @Column({ type: DataType.TEXT })
  declare error: string | null;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
