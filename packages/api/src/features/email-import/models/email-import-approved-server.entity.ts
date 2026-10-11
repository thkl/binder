import {
  AllowNull,
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

@Table({ tableName: 'email_import_approved_servers', underscored: true, timestamps: true })
export class EmailImportApprovedServer extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare host: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare port: number;

  @AllowNull
  @ForeignKey(() => User)
  @Column({ field: 'approved_by', type: DataType.UUID, allowNull: true })
  declare approvedBy: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
