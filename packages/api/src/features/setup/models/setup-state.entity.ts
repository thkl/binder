import { AllowNull, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'setup_state', underscored: true, timestamps: false })
export class SetupState extends Model {
  @PrimaryKey
  @Column({ type: DataType.SMALLINT })
  declare id: number;

  @AllowNull
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;
}
