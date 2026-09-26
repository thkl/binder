import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

export interface PipelineJobEventAttributes {
  uuid: string;
  jobUuid: string;
  type: string;
  message: string | null;
  createdAt: Date;
}

export type PipelineJobEventCreationAttributes = Omit<PipelineJobEventAttributes, 'uuid' | 'createdAt'> & {
  uuid?: string;
};

@Table({ tableName: 'pipeline_job_events', underscored: true, timestamps: false })
export class PipelineJobEvent extends Model<PipelineJobEventAttributes, PipelineJobEventCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'job_id', type: DataType.UUID, allowNull: false })
  declare jobUuid: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare type: string;

  @AllowNull
  @Column({ type: DataType.STRING(2000) })
  declare message: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;
}

