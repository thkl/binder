import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  IsEmail,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt
} from 'sequelize-typescript';

export interface UserAttributes {
  uuid: string;
  username: string;
  passwordHash: string | null;
  email: string | null;
  isAdmin: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCreationAttributes = {
  username: string;
  passwordHash?: string | null;
  email?: string | null;
  isAdmin?: boolean;
  isActive?: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: Date | null;
};

@Table({ tableName: 'users', underscored: true })
export class User extends Model<UserAttributes, UserCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type:  DataType.UUID })
  declare uuid: string;

  @Column({ type: DataType.STRING(100), unique: true })
  declare username: string;

  @AllowNull
  @Column({ field: 'password_hash', type: DataType.TEXT })
  declare passwordHash: string | null;

  @AllowNull
  @IsEmail
  @Column({ type: DataType.STRING(320) })
  declare email: string | null;

  @Column({ field: 'is_admin', type: DataType.BOOLEAN, defaultValue: false })
  declare isAdmin: boolean;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, defaultValue: true })
  declare isActive: boolean;

  @Column({ field: 'must_change_password', type: DataType.BOOLEAN, defaultValue: false })
  declare mustChangePassword: boolean;

  @AllowNull
  @Column({ field: 'last_login_at', type: DataType.DATE })
  declare lastLoginAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
