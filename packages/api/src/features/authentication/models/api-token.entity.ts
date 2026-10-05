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
import type { ApiTokenPermission } from '@binder/common';

export interface ApiTokenAttributes {
  uuid: string;
  userUuid: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  permissions: ApiTokenPermission[];
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type ApiTokenCreationAttributes = Omit<
  ApiTokenAttributes,
  'uuid' | 'createdAt' | 'updatedAt'
> & {
  uuid?: string;
};

@Table({ tableName: 'api_tokens', underscored: true, timestamps: true })
export class ApiToken extends Model<ApiTokenAttributes, ApiTokenCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'user_id', type: DataType.UUID, allowNull: false })
  declare userUuid: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ field: 'token_prefix', type: DataType.STRING(32), allowNull: false })
  declare tokenPrefix: string;

  @Column({ field: 'token_hash', type: DataType.STRING(64), allowNull: false, unique: true })
  declare tokenHash: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  declare permissions: ApiTokenPermission[];

  @AllowNull
  @Column({ field: 'last_used_at', type: DataType.DATE })
  declare lastUsedAt: Date | null;

  @AllowNull
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date | null;

  @AllowNull
  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
