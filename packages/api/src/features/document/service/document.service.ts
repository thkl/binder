import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateDocumentInputSchema,
  Document as DocumentResponse,
  DocumentSearchQuery,
  DocumentSearchResponseSchema,
  DocumentListQuery,
  DocumentListResponse,
  DocumentListResponseSchema
} from '@binder/common';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { DocumentStore } from '../store/document.store';
import { DocumentStorageService } from './document-storage.service';
import { PipelineService } from '../../pipeline/service/pipeline.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { MetadataService } from '../../metadata/service/metadata.service';
import { SetDocumentMetadataInput } from '@binder/common';
import { SetDocumentTitleInput } from '@binder/common';
import { th } from 'zod/locales';

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class DocumentService {
  private readonly logger = new BinderLogger(DocumentService.name);

  constructor(
    private readonly documents: DocumentStore,
    private readonly storage: DocumentStorageService,
    private readonly pipeline: PipelineService,
    private readonly metadata: MetadataService
  ) { }

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
      let thumbnailKey: string | null = null;
      try {
        thumbnailKey = await this.storage.createThumbnail(stored.storageKey, uuid);
      } catch {
        // Thumbnail generation is derived work. Keep the original available
        // when a PDF cannot be rendered and let the pipeline retry later.
      }
      const document = await this.documents.create({
        uuid,
        ownerUuid,
        title: file.originalname,
        ...input,
        storageKey: stored.storageKey,
        thumbnailKey,
        status: 'uploaded'
      });
      try {
        await this.pipeline.enqueue(document.uuid, ownerUuid);
      } catch (error) {
        this.logger.error(`Unable to enqueue document pipeline for ${document.uuid}`, error);
      }
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

  async search(ownerUuid: string, query: DocumentSearchQuery) {
    const result = await this.documents.searchOwned(ownerUuid, query);
    return DocumentSearchResponseSchema.parse({
      query: query.q,
      total: result.length,
      items: result.map((hit) => ({
        document: this.toDocumentResponse(hit.document),
        pageNumber: hit.pageNumber,
        snippet: this.createSnippet(hit.text, query.q),
        matchType: hit.pageNumber === null ? 'title' : 'text'
      }))
    });
  }

  async get(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return this.toDocumentResponse(document);
  }

  async updateTitle(ownerUuid: string, uuid: string, input: SetDocumentTitleInput) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    const updated = await this.documents.update(uuid, { title: input.title });
    return this.toDocumentResponse(updated ?? document);
  }

  async getFile(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return { document: this.toDocumentResponse(document), stream: await this.storage.openReadStream(document.storageKey) };
  }

  async getThumbnail(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document thumbnail not found');
    }

    let thumbnailKey = document.thumbnailKey;
    if (!thumbnailKey || !(await this.storage.exists(thumbnailKey))) {
      try {
        thumbnailKey = await this.storage.createThumbnail(document.storageKey, document.uuid);
        await this.documents.update(document.uuid, { thumbnailKey });
        document.thumbnailKey = thumbnailKey;
      } catch {
        throw new NotFoundException('Document thumbnail could not be generated');
      }
    }

    return {
      document: this.toDocumentResponse(document),
      stream: await this.storage.openReadStream(thumbnailKey)
    };
  }

  async getPipeline(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return this.pipeline.getForDocument(ownerUuid, uuid);
  }

  async requeue(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (!(await this.storage.exists(document.storageKey))) {
      throw new BadRequestException('The original document file is not available in storage');
    }

    const updated = await this.documents.update(document.uuid, { status: 'uploaded' });
    if (!updated) {
      throw new NotFoundException('Document not found');
    }

    const job = await this.pipeline.enqueue(updated.uuid, ownerUuid, 'text-extraction');
    return {
      document: this.toDocumentResponse(updated),
      job
    };
  }

  async getMetadata(ownerUuid: string, uuid: string) {
    return this.metadata.getDocumentMetadata(ownerUuid, uuid);
  }

  async setMetadata(ownerUuid: string, uuid: string, input: SetDocumentMetadataInput) {
    return this.metadata.setDocumentMetadata(ownerUuid, uuid, input);
  }

  private toDocumentResponse(document: import('../models/document.entity').Document): DocumentResponse {
    return {
      uuid: document.uuid,
      ownerUuid: document.ownerUuid,
      originalFilename: document.originalFilename,
      title: document.title,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
      storageKey: document.storageKey,
      thumbnailKey: document.thumbnailKey,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private createSnippet(text: string, query: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 320) return normalized;
    const token = query.toLocaleLowerCase().split(/\s+/).find((item) => item.length > 2) ?? query.toLocaleLowerCase();
    const index = normalized.toLocaleLowerCase().indexOf(token);
    const start = index > 0 ? Math.max(0, index - 100) : 0;
    const end = Math.min(normalized.length, start + 320);
    return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
  }
}
