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

export type AiProviderType = 'openai-compatible';

export interface AiProviderAttributes {
  uuid: string;
  name: string;
  providerType: AiProviderType;
  assistantEndpoint: string | null;
  assistantModel: string | null;
  fileUploadEndpoint: string | null;
  fileAnalysisEndpoint: string | null;
  fileAnalysisModel: string | null;
  embeddingEndpoint: string | null;
  embeddingModel: string | null;
  apiKey: string;
  apiKeyIv: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AiProviderCreationAttributes = Omit<
  AiProviderAttributes,
  'createdAt' | 'updatedAt' | 'uuid'
> & { uuid?: string };

@Table({ tableName: 'ai_provider_profiles', underscored: true, timestamps: true })
export class AiProviderProfile extends Model<AiProviderAttributes, AiProviderCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ field: 'provider_type', type: DataType.STRING(64), allowNull: false })
  declare providerType: AiProviderType;

  @AllowNull
  @Column({ field: 'assistant_endpoint', type: DataType.STRING(500), allowNull: true })
  declare assistantEndpoint: string | null;

  @AllowNull
  @Column({ field: 'assistant_model', type: DataType.STRING(150), allowNull: true })
  declare assistantModel: string | null;

  @AllowNull
  @Column({ field: 'file_upload_endpoint', type: DataType.STRING(500), allowNull: true })
  declare fileUploadEndpoint: string | null;

  @AllowNull
  @Column({ field: 'file_analysis_endpoint', type: DataType.STRING(500), allowNull: true })
  declare fileAnalysisEndpoint: string | null;

  @AllowNull
  @Column({ field: 'file_analysis_model', type: DataType.STRING(150), allowNull: true })
  declare fileAnalysisModel: string | null;

  @AllowNull
  @Column({ field: 'embedding_endpoint', type: DataType.STRING(500), allowNull: true })
  declare embeddingEndpoint: string | null;

  @AllowNull
  @Column({ field: 'embedding_model', type: DataType.STRING(150), allowNull: true })
  declare embeddingModel: string | null;

  @Column({ field: 'api_key', type: DataType.TEXT, allowNull: false, defaultValue: '' })
  declare apiKey: string;

  @AllowNull
  @Column({ field: 'api_key_iv', type: DataType.STRING(32), allowNull: true })
  declare apiKeyIv: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare enabled: boolean;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}
