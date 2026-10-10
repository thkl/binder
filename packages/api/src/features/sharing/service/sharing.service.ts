import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ShareGrantsResponseSchema,
  ShareRecipientsResponseSchema,
} from '@binder/common';
import { UserStore } from '../../authentication/stores/user.store';
import { DocumentStore } from '../../document/store/document.store';
import { FolderStore } from '../../folder/store/folder.store';
import { DocumentShareStore } from '../store/document-share.store';
import { FolderShareStore } from '../store/folder-share.store';

@Injectable()
export class SharingService {
  constructor(
    private readonly users: UserStore,
    private readonly documents: DocumentStore,
    private readonly folders: FolderStore,
    private readonly documentShares: DocumentShareStore,
    private readonly folderShares: FolderShareStore,
  ) {}

  async listRecipients(userUuid: string) {
    const users = await this.users.findShareCandidates(userUuid);
    return ShareRecipientsResponseSchema.parse({
      items: users.map((user) => ({ uuid: user.uuid, username: user.username })),
    });
  }

  async listDocumentShares(ownerUuid: string, documentUuid: string) {
    await this.requireOwnedDocument(ownerUuid, documentUuid);
    const shares = await this.documentShares.listForOwnerDocument(ownerUuid, documentUuid);
    const recipients = await this.users.findByUuids(shares.map((share) => share.recipientUserUuid));
    const names = new Map(recipients.map((user) => [user.uuid, user.username]));
    return ShareGrantsResponseSchema.parse({
      items: shares.flatMap((share) => {
        const recipientUsername = names.get(share.recipientUserUuid);
        return recipientUsername
          ? [{
              uuid: share.uuid,
              recipientUuid: share.recipientUserUuid,
              recipientUsername,
              createdAt: share.createdAt.toISOString(),
            }]
          : [];
      }),
    });
  }

  async shareDocument(ownerUuid: string, documentUuid: string, recipientUuid: string) {
    await this.requireOwnedDocument(ownerUuid, documentUuid);
    await this.requireRecipient(ownerUuid, recipientUuid);
    await this.documentShares.createShare(ownerUuid, documentUuid, recipientUuid);
    return this.listDocumentShares(ownerUuid, documentUuid);
  }

  async revokeDocumentShare(ownerUuid: string, documentUuid: string, recipientUuid: string) {
    await this.requireOwnedDocument(ownerUuid, documentUuid);
    await this.documentShares.removeShare(ownerUuid, documentUuid, recipientUuid);
    return this.listDocumentShares(ownerUuid, documentUuid);
  }

  async listFolderShares(ownerUuid: string, folderUuid: string) {
    await this.requireOwnedFolder(ownerUuid, folderUuid);
    const shares = await this.folderShares.listForOwnerFolder(ownerUuid, folderUuid);
    const recipients = await this.users.findByUuids(shares.map((share) => share.recipientUserUuid));
    const names = new Map(recipients.map((user) => [user.uuid, user.username]));
    return ShareGrantsResponseSchema.parse({
      items: shares.flatMap((share) => {
        const recipientUsername = names.get(share.recipientUserUuid);
        return recipientUsername
          ? [{
              uuid: share.uuid,
              recipientUuid: share.recipientUserUuid,
              recipientUsername,
              createdAt: share.createdAt.toISOString(),
            }]
          : [];
      }),
    });
  }

  async shareFolder(ownerUuid: string, folderUuid: string, recipientUuid: string) {
    await this.requireOwnedFolder(ownerUuid, folderUuid);
    await this.requireRecipient(ownerUuid, recipientUuid);
    await this.folderShares.createShare(ownerUuid, folderUuid, recipientUuid);
    return this.listFolderShares(ownerUuid, folderUuid);
  }

  async revokeFolderShare(ownerUuid: string, folderUuid: string, recipientUuid: string) {
    await this.requireOwnedFolder(ownerUuid, folderUuid);
    await this.folderShares.removeShare(ownerUuid, folderUuid, recipientUuid);
    return this.listFolderShares(ownerUuid, folderUuid);
  }

  async listReceivedDocumentGrants(userUuid: string) {
    const [directShares, folderShares] = await Promise.all([
      this.documentShares.listForRecipient(userUuid),
      this.folderShares.listForRecipient(userUuid),
    ]);
    const sharedAtByDocument = new Map<string, Date>();
    for (const share of directShares) sharedAtByDocument.set(share.documentUuid, share.createdAt);
    for (const share of folderShares) {
      const subtree = await this.folders.listSubtree(share.ownerUuid, share.folderUuid);
      const links = await this.folders.listDocumentLinksForFolders(subtree.map((folder) => folder.uuid));
      for (const link of links) {
        const existing = sharedAtByDocument.get(link.documentUuid);
        if (!existing || share.createdAt < existing) sharedAtByDocument.set(link.documentUuid, share.createdAt);
      }
    }
    return sharedAtByDocument;
  }

  async listReceivedFolders(userUuid: string) {
    const shares = await this.folderShares.listForRecipient(userUuid);
    const [folders, owners] = await Promise.all([
      Promise.all(shares.map((share) => this.folders.findOwned(share.ownerUuid, share.folderUuid))),
      this.users.findByUuids(shares.map((share) => share.ownerUuid)),
    ]);
    const ownerNames = new Map(owners.filter((owner) => owner.isActive).map((owner) => [owner.uuid, owner.username]));
    return shares.flatMap((share, index) => {
      const folder = folders[index];
      const ownerUsername = ownerNames.get(share.ownerUuid);
      return folder && ownerUsername
        ? [{
            uuid: folder.uuid,
            ownerUuid: folder.ownerUuid,
            name: folder.name,
            ownerUsername,
            sharedAt: share.createdAt.toISOString(),
          }]
        : [];
    });
  }

  async listReceivedFolderDocumentUuids(userUuid: string, folderUuid: string): Promise<string[]> {
    const shares = await this.folderShares.listForRecipient(userUuid);
    const sharedSubtreeUuids = new Set<string>();
    for (const share of shares) {
      const subtree = await this.folders.listSubtree(share.ownerUuid, share.folderUuid);
      if (subtree.some((folder) => folder.uuid === folderUuid)) {
        for (const folder of subtree) sharedSubtreeUuids.add(folder.uuid);
      }
    }
    if (!sharedSubtreeUuids.has(folderUuid)) throw new NotFoundException('Shared folder not found');
    const links = await this.folders.listDocumentLinksForFolders([...sharedSubtreeUuids]);
    return [...new Set(links.map((link) => link.documentUuid))];
  }

  async listReadableDocumentUuids(userUuid: string): Promise<string[]> {
    const [directShares, folderShares] = await Promise.all([
      this.documentShares.listForRecipient(userUuid),
      this.folderShares.listForRecipient(userUuid),
    ]);
    const folderUuids = new Set<string>();
    for (const share of folderShares) {
      const subtree = await this.folders.listSubtree(share.ownerUuid, share.folderUuid);
      for (const folder of subtree) folderUuids.add(folder.uuid);
    }
    const links = await this.folders.listDocumentLinksForFolders([...folderUuids]);
    return [...new Set([
      ...directShares.map((share) => share.documentUuid),
      ...links.map((link) => link.documentUuid),
    ])];
  }

  async canReadDocument(userUuid: string, documentUuid: string): Promise<boolean> {
    const document = (await this.documents.findAccessibleCandidates([documentUuid]))[0];
    if (!document) return false;
    if (document.ownerUuid === userUuid) return true;
    if (await this.documentShares.hasShare(userUuid, documentUuid)) return true;
    return (await this.listReadableDocumentUuids(userUuid)).includes(documentUuid);
  }

  private async requireOwnedDocument(ownerUuid: string, documentUuid: string): Promise<void> {
    if (!(await this.documents.findOwnedByUuid(ownerUuid, documentUuid))) {
      throw new NotFoundException('Document not found');
    }
  }

  private async requireOwnedFolder(ownerUuid: string, folderUuid: string): Promise<void> {
    if (!(await this.folders.findOwned(ownerUuid, folderUuid))) {
      throw new NotFoundException('Folder not found');
    }
  }

  private async requireRecipient(ownerUuid: string, recipientUuid: string): Promise<void> {
    if (recipientUuid === ownerUuid) throw new BadRequestException('You cannot share with yourself');
    const recipient = await this.users.findById(recipientUuid);
    if (!recipient || !recipient.isActive) throw new NotFoundException('Active user not found');
  }
}
