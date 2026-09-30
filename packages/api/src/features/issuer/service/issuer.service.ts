import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateIssuerInput,
  IssuerListResponseSchema,
  IssuerSchema,
  UpdateIssuerInput,
} from '@binder/common';
import { IssuerStore } from '../store/issuer.store';
import { FolderStore } from '../../folder/store/folder.store';

@Injectable()
export class IssuerService {
  constructor(
    private readonly issuers: IssuerStore,
    private readonly folders: FolderStore,
  ) {}

  async list(ownerUuid: string, query?: string) {
    const items = await this.issuers.listOwned(ownerUuid, query);
    return IssuerListResponseSchema.parse({ items: items.map((item) => this.toResponse(item)) });
  }

  async create(ownerUuid: string, input: CreateIssuerInput) {
    if (input.folderUuid) await this.ensureFolder(ownerUuid, input.folderUuid);
    const issuer = await this.issuers.create({
      uuid: undefined,
      ownerUuid,
      name: input.name,
      address: input.address ?? null,
      zipCode: input.zipCode ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      custom: input.custom ?? {},
      folderUuid: input.folderUuid ?? null,
    });
    return this.toResponse(issuer);
  }

  async update(ownerUuid: string, uuid: string, input: UpdateIssuerInput) {
    const existing = await this.issuers.findOwned(ownerUuid, uuid);
    if (!existing) throw new NotFoundException('Issuer not found');
    if (input.folderUuid) await this.ensureFolder(ownerUuid, input.folderUuid);
    const updated = await this.issuers.update(uuid, {
      ...input,
      address: input.address === undefined ? existing.address : input.address,
      zipCode: input.zipCode === undefined ? existing.zipCode : input.zipCode,
      city: input.city === undefined ? existing.city : input.city,
      country: input.country === undefined ? existing.country : input.country,
      custom: input.custom === undefined ? existing.custom : input.custom,
      folderUuid: input.folderUuid === undefined ? existing.folderUuid : input.folderUuid,
    });
    return this.toResponse(updated ?? existing);
  }

  private toResponse(item: import('../models/issuer.entity').Issuer) {
    return IssuerSchema.parse({
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      name: item.name,
      address: item.address,
      zipCode: item.zipCode,
      city: item.city,
      country: item.country,
      custom: item.custom ?? {},
      folderUuid: item.folderUuid,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
  }

  private async ensureFolder(ownerUuid: string, folderUuid: string): Promise<void> {
    if (!(await this.folders.findOwned(ownerUuid, folderUuid)))
      throw new NotFoundException('Folder not found');
  }
}
