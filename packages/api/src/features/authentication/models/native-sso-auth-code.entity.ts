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

@Table({ tableName: 'native_sso_auth_codes', underscored: true, timestamps: false })
export class NativeSSOAuthCode extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'user_id', type: DataType.UUID, allowNull: false })
  declare userUuid: string;

  @Column({ field: 'code_hash', type: DataType.STRING(64), allowNull: false, unique: true })
  declare codeHash: string;

  @Column({ field: 'code_challenge', type: DataType.STRING(128), allowNull: false })
  declare codeChallenge: string;

  @Column({ field: 'app_state', type: DataType.STRING(128), allowNull: false })
  declare appState: string;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @AllowNull
  @Column({ field: 'used_at', type: DataType.DATE, allowNull: true })
  declare usedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
