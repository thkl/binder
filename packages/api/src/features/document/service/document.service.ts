import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateDocumentInputSchema,
  Document as DocumentResponse,
  DocumentListQuery,
  DocumentListResponse,
  DocumentListResponseSchema
} from '@binder/common';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { DocumentStore } from '../store/document.store';
import { DocumentStorageService } from './document-storage.service';

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class DocumentService {
  constructor(
    private readonly documents: DocumentStore,
    private readonly storage: DocumentStorageService
  ) {}

  async upload(ownerUuid: string, file: UploadedDocumentFile) {
    if (!file || file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF documents are supported');
    }

    const uuid = randomUUID();
    const stored = await this.storage.storePdf(file.buffer, uuid, file.originalname);

    try {
      const input = CreateDocumentInputSchema.parse({
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256
      });
      const document = await this.documents.create({
        uuid,
        ownerUuid,
        ...input,
        storageKey: stored.storageKey,
        status: 'uploaded'
      });
      return this.toDocumentResponse(document);
    } catch (error) {
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListResponse> {
    const result = await this.documents.findOwnedPage(ownerUuid, query);
    return DocumentListResponseSchema.parse({
      ...result,
      items: result.items.map((document) => this.toDocumentResponse(document))
    });
  }

  async get(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return this.toDocumentResponse(document);
  }

  async getFile(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return { document: this.toDocumentResponse(document), stream: this.storage.openReadStream(document.storageKey) };
  }

  private toDocumentResponse(document: import('../models/document.entity').Document): DocumentResponse {
    return {
      uuid: document.uuid,
      ownerUuid: document.ownerUuid,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
      storageKey: document.storageKey,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString()
    };
  }
}
