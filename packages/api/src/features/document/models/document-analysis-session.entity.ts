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
import type { DocumentAnalysisMessage } from '@binder/common';

export interface DocumentAnalysisSessionAttributes {
  uuid: string;
  ownerUuid: string;
  documentUuid: string;
  providerUuid: string | null;
  remoteFileId: string;
  remoteResponseId: string | null;
  fileExpiresAt: Date | null;
  messages: DocumentAnalysisMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentAnalysisSessionCreationAttributes = Omit<
  DocumentAnalysisSessionAttributes,
  'createdAt' | 'updatedAt' | 'uuid'
> & { uuid?: string };

@Table({ tableName: 'document_analysis_sessions', underscored: true, timestamps: true })
export class DocumentAnalysisSession extends Model<
  DocumentAnalysisSessionAttributes,
  DocumentAnalysisSessionCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ field: 'document_id', type: DataType.UUID, allowNull: false })
  declare documentUuid: string;

  @AllowNull
  @Column({ field: 'provider_id', type: DataType.UUID, allowNull: true })
  declare providerUuid: string | null;

  @Column({ field: 'remote_file_id', type: DataType.STRING(255), allowNull: false })
  declare remoteFileId: string;

  @AllowNull
  @Column({ field: 'remote_response_id', type: DataType.STRING(255), allowNull: true })
  declare remoteResponseId: string | null;

  @AllowNull
  @Column({ field: 'file_expires_at', type: DataType.DATE, allowNull: true })
  declare fileExpiresAt: Date | null;

  @Column({
    field: 'messages',
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
  })
  declare messages: DocumentAnalysisMessage[];

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
