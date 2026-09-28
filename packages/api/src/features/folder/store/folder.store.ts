import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentFolder } from '../models/document-folder.entity';
import { Folder } from '../models/folder.entity';

@Injectable()
export class FolderStore extends BaseCrudStore<Folder> {
  constructor() {
    super(Folder);
    this.registerIdField('uuid');
  }

  findOwned(ownerUuid: string, uuid: string): Promise<Folder | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  listChildren(ownerUuid: string, parentUuid: string | null): Promise<Folder[]> {
    return this.model.findAll({
      where: {
        ownerUuid,
        parentUuid: parentUuid === null ? { [Op.is]: null } : parentUuid
      },
      order: [['sortPosition', 'ASC'], ['name', 'ASC'], ['uuid', 'ASC']]
    });
  }

  countChildren(ownerUuid: string, parentUuid: string): Promise<number> {
    return this.model.count({ where: { ownerUuid, parentUuid } });
  }

  countDocuments(folderUuid: string): Promise<number> {
    return DocumentFolder.count({ where: { folderUuid } });
  }

  listDocumentLinks(folderUuid: string, documentUuids: string[]): Promise<DocumentFolder[]> {
    return DocumentFolder.findAll({ where: { folderUuid, documentUuid: { [Op.in]: documentUuids } } });
  }

  createLinks(folderUuid: string, documentUuids: string[]): Promise<[number, number]> {
    return DocumentFolder.bulkCreate(
      documentUuids.map((documentUuid) => ({ folderUuid, documentUuid })),
      { ignoreDuplicates: true }
    ).then((created) => [created.length, documentUuids.length - created.length]);
  }

  removeLinks(folderUuid: string, documentUuids?: string[]): Promise<number> {
    return DocumentFolder.destroy({ where: { folderUuid, ...(documentUuids ? { documentUuid: { [Op.in]: documentUuids } } : {}) } });
  }

  removeFolderLinks(folderUuid: string): Promise<number> {
    return DocumentFolder.destroy({ where: { folderUuid } });
  }
}
