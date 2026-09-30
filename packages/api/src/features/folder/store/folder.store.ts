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
        parentUuid: parentUuid === null ? { [Op.is]: null } : parentUuid,
      },
      order: [
        ['sortPosition', 'ASC'],
        ['name', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  listAll(ownerUuid: string): Promise<Folder[]> {
    return this.model.findAll({
      where: { ownerUuid },
      order: [
        ['name', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  async listSubtree(ownerUuid: string, rootUuid: string): Promise<Folder[]> {
    const folders = await this.listAll(ownerUuid);
    const foldersByParent = new Map<string | null, Folder[]>();

    for (const folder of folders) {
      const children = foldersByParent.get(folder.parentUuid) ?? [];
      children.push(folder);
      foldersByParent.set(folder.parentUuid, children);
    }

    const root = folders.find((folder) => folder.uuid === rootUuid);
    if (!root) return [];

    const result: Folder[] = [];
    const visit = (folder: Folder): void => {
      result.push(folder);
      for (const child of foldersByParent.get(folder.uuid) ?? []) {
        visit(child);
      }
    };
    visit(root);
    return result;
  }

  async listForDocument(ownerUuid: string, documentUuid: string): Promise<Folder[]> {
    const links = await DocumentFolder.findAll({
      where: { documentUuid },
      attributes: ['folderUuid'],
    });
    const folderUuids = links.map((link) => link.folderUuid);
    if (folderUuids.length === 0) return [];
    return this.model.findAll({
      where: { ownerUuid, uuid: { [Op.in]: folderUuids } },
      order: [
        ['name', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  countChildren(ownerUuid: string, parentUuid: string): Promise<number> {
    return this.model.count({ where: { ownerUuid, parentUuid } });
  }

  countDocuments(folderUuid: string): Promise<number> {
    return DocumentFolder.count({ where: { folderUuid } });
  }

  listDocumentLinks(folderUuid: string, documentUuids: string[]): Promise<DocumentFolder[]> {
    return DocumentFolder.findAll({
      where: { folderUuid, documentUuid: { [Op.in]: documentUuids } },
    });
  }

  listDocumentLinksForFolders(folderUuids: string[]): Promise<DocumentFolder[]> {
    if (folderUuids.length === 0) return Promise.resolve([]);
    return DocumentFolder.findAll({
      where: { folderUuid: { [Op.in]: folderUuids } },
      order: [
        ['folderUuid', 'ASC'],
        ['documentUuid', 'ASC'],
      ],
    });
  }

  createLinks(folderUuid: string, documentUuids: string[]): Promise<[number, number]> {
    return DocumentFolder.bulkCreate(
      documentUuids.map((documentUuid) => ({ folderUuid, documentUuid })),
      { ignoreDuplicates: true },
    ).then((created) => [created.length, documentUuids.length - created.length]);
  }

  removeLinks(folderUuid: string, documentUuids?: string[]): Promise<number> {
    return DocumentFolder.destroy({
      where: { folderUuid, ...(documentUuids ? { documentUuid: { [Op.in]: documentUuids } } : {}) },
    });
  }

  removeFolderLinks(folderUuid: string): Promise<number> {
    return DocumentFolder.destroy({ where: { folderUuid } });
  }
}
