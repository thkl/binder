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

export interface EmailImportConfigAttributes {
  uuid: string;
  ownerUuid: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string | null;
  passwordIv: string | null;
  mailbox: string;
  pollIntervalMs: number;
  deleteAfterImport: boolean;
  trustedSenders: string[];
  lastPolledAt: Date | null;
  lastUidValidity: string | null;
  lastMessageUid: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmailImportConfigCreationAttributes = Omit<
  EmailImportConfigAttributes,
  'uuid' | 'createdAt' | 'updatedAt' | 'lastPolledAt' | 'lastUidValidity' | 'lastMessageUid' | 'lastError'
> & {
  uuid?: string;
  lastPolledAt?: Date | null;
  lastUidValidity?: string | null;
  lastMessageUid?: string | null;
  lastError?: string | null;
};

@Table({ tableName: 'email_import_configs', underscored: true, timestamps: true })
export class EmailImportConfig extends Model<
  EmailImportConfigAttributes,
  EmailImportConfigCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false, unique: true })
  declare ownerUuid: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare enabled: boolean;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare host: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 993 })
  declare port: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare secure: boolean;

  @Column({ type: DataType.STRING(320), allowNull: false })
  declare username: string;

  @AllowNull
  @Column({ type: DataType.TEXT, allowNull: true })
  declare password: string | null;

  @AllowNull
  @Column({ field: 'password_iv', type: DataType.STRING(32), allowNull: true })
  declare passwordIv: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false, defaultValue: 'INBOX' })
  declare mailbox: string;

  @Column({ field: 'poll_interval_ms', type: DataType.INTEGER, allowNull: false, defaultValue: 900000 })
  declare pollIntervalMs: number;

  @Column({ field: 'delete_after_import', type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare deleteAfterImport: boolean;

  @Column({ field: 'trusted_senders', type: DataType.JSONB, allowNull: false, defaultValue: [] })
  declare trustedSenders: string[];

  @AllowNull
  @Column({ field: 'last_polled_at', type: DataType.DATE, allowNull: true })
  declare lastPolledAt: Date | null;

  @AllowNull
  @Column({ field: 'last_uid_validity', type: DataType.STRING(40), allowNull: true })
  declare lastUidValidity: string | null;

  @AllowNull
  @Column({ field: 'last_message_uid', type: DataType.STRING(40), allowNull: true })
  declare lastMessageUid: string | null;

  @AllowNull
  @Column({ field: 'last_error', type: DataType.TEXT, allowNull: true })
  declare lastError: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
