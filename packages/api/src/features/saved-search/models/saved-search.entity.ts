import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { SavedSearchDefinition, SavedSearchKind } from '@binder/common';

export interface SavedSearchAttributes {
  uuid: string;
  ownerUuid: string;
  name: string;
  kind: SavedSearchKind;
  definition: SavedSearchDefinition;
  createdAt: Date;
  updatedAt: Date;
}

export type SavedSearchCreationAttributes = Omit<
  SavedSearchAttributes,
  'createdAt' | 'updatedAt' | 'uuid'
> & {
  uuid?: string;
};

@Table({ tableName: 'saved_searches', underscored: true, timestamps: true })
export class SavedSearch extends Model<SavedSearchAttributes, SavedSearchCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ field: 'id', type: DataType.UUID })
  declare uuid: string;

  @Column({ field: 'owner_id', type: DataType.UUID, allowNull: false })
  declare ownerUuid: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ field: 'search_type', type: DataType.STRING(32), allowNull: false })
  declare kind: SavedSearchKind;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare definition: SavedSearchDefinition;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare readonly createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare readonly updatedAt: Date;
}
