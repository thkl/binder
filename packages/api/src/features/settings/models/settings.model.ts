import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({
  tableName: 'settings',
  timestamps: true,
  indexes: [{ fields: ['key'], unique: true }, { fields: ['isEncrypted'] }],
})
export class ApplicationSetting extends Model {
  /**
   * Setting key (unique identifier)
   * Use dot notation for namespacing
   * @example "mail.host", "mail.port", "scanner.batchSize"
   */
  @PrimaryKey
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare key: string;

  /**
   * Setting value
   * - Plain text for non-sensitive settings
   * - Base64-encoded ciphertext for encrypted settings
   * - Supports any string value (JSON can be stored as stringified)
   */
  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare value: string;

  /**
   * Initialization Vector for encrypted values
   * - Hex-encoded IV (32 characters = 16 bytes)
   * - Only required when isEncrypted = true
   * - Unique per encryption operation
   */
  @Column({
    type: DataType.STRING(32),
    allowNull: true,
    field: 'value_iv',
  })
  declare valueIv?: string;

  /**
   * Whether the value is encrypted using AES-256-CBC
   * - true: value is encrypted, requires valueIv for decryption
   * - false: value is plain text
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_encrypted',
  })
  declare isEncrypted: boolean;

  /**
   * Human-readable description of what this setting controls
   * Displayed in admin UI
   * @example "SMTP server hostname for sending email notifications"
   */
  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare description?: string;

  /**
   * Timestamp when setting was created
   */
  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: () => new Date(),
    field: 'created_at',
  })
  declare readonly createdAt: Date;

  /**
   * Timestamp when setting was last updated
   * Useful for audit trail
   */
  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: () => new Date(),
    field: 'updated_at',
  })
  declare readonly updatedAt: Date;
}
