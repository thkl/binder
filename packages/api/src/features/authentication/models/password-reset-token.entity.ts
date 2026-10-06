import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({ tableName: 'password_reset_tokens', underscored: true, timestamps: false })
export class PasswordResetToken extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'user_id', type: DataType.UUID, allowNull: false })
  declare userUuid: string;

  @Column({ field: 'token_hash', type: DataType.STRING(64), allowNull: false, unique: true })
  declare tokenHash: string;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @AllowNull
  @Column({ field: 'used_at', type: DataType.DATE, allowNull: true })
  declare usedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
