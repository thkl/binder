import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { FolderShare } from '../models/folder-share.entity';

@Injectable()
export class FolderShareStore extends BaseCrudStore<FolderShare> {
  constructor() {
    super(FolderShare);
    this.registerIdField('uuid');
  }

  listForOwnerFolder(ownerUuid: string, folderUuid: string): Promise<FolderShare[]> {
    return this.model.findAll({
      where: { ownerUuid, folderUuid },
      order: [
        ['createdAt', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  listForOwner(ownerUuid: string): Promise<FolderShare[]> {
    return this.model.findAll({
      where: { ownerUuid },
      attributes: ['folderUuid', 'recipientUserUuid'],
    });
  }

  listForOwnerFolders(ownerUuid: string, folderUuids: string[]): Promise<FolderShare[]> {
    if (folderUuids.length === 0) return Promise.resolve([]);
    return this.model.findAll({ where: { ownerUuid, folderUuid: { [Op.in]: folderUuids } } });
  }

  listForRecipient(recipientUserUuid: string): Promise<FolderShare[]> {
    return this.model.findAll({
      where: { recipientUserUuid },
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  async createShare(
    ownerUuid: string,
    folderUuid: string,
    recipientUserUuid: string,
  ): Promise<void> {
    await this.model.findOrCreate({
      where: { folderUuid, recipientUserUuid },
      defaults: { ownerUuid, folderUuid, recipientUserUuid },
    });
  }

  removeShare(ownerUuid: string, folderUuid: string, recipientUserUuid: string): Promise<number> {
    return this.model.destroy({ where: { ownerUuid, folderUuid, recipientUserUuid } });
  }
}
