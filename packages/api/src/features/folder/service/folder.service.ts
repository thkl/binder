import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateFolderInput,
  FolderDeleteResponseSchema,
  FolderDocumentActionResponseSchema,
  FolderDocumentInput,
  FolderDocumentListResponseSchema,
  FolderListResponseSchema,
  FolderNodeSchema,
  MoveFolderInput,
  UpdateFolderInput,
} from '@binder/common';
import { DocumentStore } from '../../document/store/document.store';
import { FolderStore } from '../store/folder.store';

@Injectable()
export class FolderService {
  constructor(
    private readonly folders: FolderStore,
    private readonly documents: DocumentStore,
  ) {}

  async list(ownerUuid: string, parentUuid: string | null) {
    if (parentUuid && !(await this.folders.findOwned(ownerUuid, parentUuid))) {
      throw new NotFoundException('Parent folder not found');
    }

    const folders = await this.folders.listChildren(ownerUuid, parentUuid);
    const items = await Promise.all(folders.map(async (folder) => this.toNode(folder)));
    return FolderListResponseSchema.parse({ parentUuid, items });
  }

  async listAll(ownerUuid: string) {
    const folders = await this.folders.listAll(ownerUuid);
    return FolderDocumentListResponseSchema.parse({
      items: await Promise.all(folders.map((folder) => this.toNode(folder))),
    });
  }

  async listForDocument(ownerUuid: string, documentUuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');
    const folders = await this.folders.listForDocument(ownerUuid, documentUuid);
    return FolderDocumentListResponseSchema.parse({
      items: await Promise.all(folders.map((folder) => this.toNode(folder))),
    });
  }

  async create(ownerUuid: string, input: CreateFolderInput) {
    if (input.parentUuid && !(await this.folders.findOwned(ownerUuid, input.parentUuid))) {
      throw new NotFoundException('Parent folder not found');
    }

    try {
      const folder = await this.folders.create({
        uuid: undefined,
        ownerUuid,
        parentUuid: input.parentUuid ?? null,
        name: input.name.trim(),
        sortPosition: input.sortPosition ?? 0,
      });
      return this.toNode(folder);
    } catch (error) {
      this.throwFolderConflict(error);
    }
  }

  async update(ownerUuid: string, uuid: string, input: UpdateFolderInput) {
    const folder = await this.requireFolder(ownerUuid, uuid);

    try {
      const updated = await this.folders.update(uuid, {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.sortPosition === undefined ? {} : { sortPosition: input.sortPosition }),
      });
      return this.toNode(updated ?? folder);
    } catch (error) {
      this.throwFolderConflict(error);
    }
  }

  async move(ownerUuid: string, uuid: string, input: MoveFolderInput) {
    const folder = await this.requireFolder(ownerUuid, uuid);
    if (input.parentUuid === uuid) {
      throw new ConflictException('A folder cannot contain itself');
    }
    if (input.parentUuid) {
      await this.requireFolder(ownerUuid, input.parentUuid);
      await this.assertNotDescendant(ownerUuid, uuid, input.parentUuid);
    }

    try {
      const updated = await this.folders.update(uuid, {
        parentUuid: input.parentUuid,
        ...(input.sortPosition === undefined ? {} : { sortPosition: input.sortPosition }),
      });
      return this.toNode(updated ?? folder);
    } catch (error) {
      this.throwFolderConflict(error);
    }
  }

  async remove(ownerUuid: string, uuid: string) {
    const folder = await this.requireFolder(ownerUuid, uuid);
    const children = await this.folders.listChildren(ownerUuid, uuid);
    for (const child of children) {
      await this.folders.update(child.uuid, { parentUuid: null });
    }
    const removedLinks = await this.folders.removeFolderLinks(uuid);
    await folder.destroy();
    return FolderDeleteResponseSchema.parse({
      deleted: true,
      promotedChildren: children.length,
      removedLinks,
    });
  }

  async linkDocuments(ownerUuid: string, folderUuid: string, input: FolderDocumentInput) {
    await this.requireFolder(ownerUuid, folderUuid);
    const documentUuids = [...new Set(input.documentUuids)];
    const documents = await this.documents.findOwnedByUuids(ownerUuid, documentUuids);
    const ownedUuids = new Set(documents.map((document) => document.uuid));
    const eligibleUuids = documentUuids.filter((uuid) => ownedUuids.has(uuid));
    const [created, duplicate] = await this.folders.createLinks(folderUuid, eligibleUuids);
    return FolderDocumentActionResponseSchema.parse({
      folderUuid,
      affected: created,
      skipped: duplicate + documentUuids.length - eligibleUuids.length,
    });
  }

  async ensureOwned(ownerUuid: string, uuid: string): Promise<void> {
    await this.requireFolder(ownerUuid, uuid);
  }

  async applyMetadataRouting(
    ownerUuid: string,
    documentUuid: string,
    folderUuids: string[],
  ): Promise<void> {
    for (const folderUuid of [...new Set(folderUuids)]) {
      await this.linkDocuments(ownerUuid, folderUuid, { documentUuids: [documentUuid] });
    }
  }

  async unlinkDocuments(ownerUuid: string, folderUuid: string, input: FolderDocumentInput) {
    await this.requireFolder(ownerUuid, folderUuid);
    const documentUuids = [...new Set(input.documentUuids)];
    const affected = await this.folders.removeLinks(folderUuid, documentUuids);
    return FolderDocumentActionResponseSchema.parse({
      folderUuid,
      affected,
      skipped: documentUuids.length - affected,
    });
  }

  private async requireFolder(ownerUuid: string, uuid: string) {
    const folder = await this.folders.findOwned(ownerUuid, uuid);
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  private async assertNotDescendant(
    ownerUuid: string,
    folderUuid: string,
    parentUuid: string,
  ): Promise<void> {
    const visited = new Set<string>();
    let current: string | null = parentUuid;
    while (current) {
      if (current === folderUuid) {
        throw new ConflictException(
          'A folder cannot be moved into itself or one of its descendants',
        );
      }
      if (visited.has(current)) {
        throw new ConflictException('The folder hierarchy contains a cycle');
      }
      visited.add(current);
      const parent = await this.folders.findOwned(ownerUuid, current);
      current = parent?.parentUuid ?? null;
    }
  }

  private async toNode(folder: import('../models/folder.entity').Folder) {
    const [childCount, documentCount] = await Promise.all([
      this.folders.countChildren(folder.ownerUuid, folder.uuid),
      this.folders.countDocuments(folder.uuid),
    ]);
    return FolderNodeSchema.parse({
      uuid: folder.uuid,
      ownerUuid: folder.ownerUuid,
      parentUuid: folder.parentUuid,
      name: folder.name,
      sortPosition: folder.sortPosition,
      childCount,
      documentCount,
      hasChildren: childCount > 0,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    });
  }

  private throwFolderConflict(error: unknown): never {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      throw new ConflictException('A folder with this name already exists here');
    }
    throw error;
  }
}
