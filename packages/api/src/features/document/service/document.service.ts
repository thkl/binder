import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ZipArchive } from 'archiver';
import {
  CreateDocumentInputSchema,
  Document as DocumentResponse,
  DocumentSearchQuery,
  DocumentSearchResponseSchema,
  DocumentBulkActionInput,
  DocumentBulkActionResponseSchema,
  DocumentListQuery,
  DocumentListFacetsResponse,
  DocumentListFacetsResponseSchema,
  DocumentListResponse,
  DocumentListResponseSchema,
  DocumentStorageIssueListResponseSchema
} from '@binder/common';
import { ClearDocumentSuggestionResponseSchema, DocumentExtractedTextResponseSchema, DocumentMetadataSummary, DocumentTitleSuggestion, SetDocumentMetadataInput } from '@binder/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import type { Express } from 'express';
import { DocumentStore } from '../store/document.store';
import { DocumentStorageService } from './document-storage.service';
import { PipelineService } from '../../pipeline/service/pipeline.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { MetadataService } from '../../metadata/service/metadata.service';
import { SetDocumentTitleInput } from '@binder/common';
import { th } from 'zod/locales';
import { SemanticSearchService } from './semantic-search.service';
import { TitleSuggestionService } from './title-suggestion.service';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { FolderStore } from '../../folder/store/folder.store';
import { DocumentStorageIssueStore } from '../store/document-storage-issue.store';
import { InboxItemStore } from '../../inbox/store/inbox-item.store';

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class DocumentService {
  private readonly logger = new BinderLogger(DocumentService.name);
  private readonly thumbnailGeneration = new Map<string, Promise<string>>();

  constructor(
    private readonly documents: DocumentStore,
    private readonly storage: DocumentStorageService,
    private readonly pipeline: PipelineService,
    private readonly metadata: MetadataService,
    private readonly semanticSearch: SemanticSearchService,
    private readonly titleSuggestions: TitleSuggestionService,
    private readonly config: ConfigService<BinderConfig>,
    private readonly folders: FolderStore,
    private readonly storageIssues: DocumentStorageIssueStore,
    private readonly inboxItems: InboxItemStore,
    private readonly eventEmitter: EventEmitter2
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
        pageCount: 1,
        issuerUuid: null,
        isNew: true,
        status: 'uploaded'
      });
      await this.addManualUploadToInbox(document.uuid, ownerUuid, file, stored.checksumSha256, stored.sizeBytes);
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

  private async addManualUploadToInbox(
    documentUuid: string,
    ownerUuid: string,
    file: UploadedDocumentFile,
    checksumSha256: string,
    sizeBytes: number
  ): Promise<void> {
    try {
      await this.inboxItems.create({
        ownerUuid,
        documentUuid,
        originalFilename: file.originalname,
        checksumSha256,
        sizeBytes,
        status: 'imported',
        aiStatus: 'pending',
        aiSuggestion: null,
        autoApplied: false,
        lastError: null,
        aiError: null
      });
      this.eventEmitter.emit('inbox.changed', { reason: 'manual-upload' });
    } catch (error) {
      this.logger.error(`Unable to add manually uploaded document ${documentUuid} to the inbox`, error);
    }
  }

  async list(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListResponse> {
    const result = await this.documents.findOwnedPage(ownerUuid, query);
    const summaries = await this.metadata.getDocumentMetadataSummaries(ownerUuid, result.items);
    return DocumentListResponseSchema.parse({
      ...result,
      groupBy: query.groupBy,
      items: result.items.map((document) => this.toDocumentResponse(document, summaries.get(document.uuid)))
    });
  }

  async listStorageIssues(ownerUuid: string) {
    const issues = await this.storageIssues.findOpenOwned(ownerUuid);
    const documents = await this.documents.findOwnedByUuids(
      ownerUuid,
      issues.map((issue) => issue.documentUuid)
    );
    const documentsByUuid = new Map(documents.map((document) => [document.uuid, document]));

    return DocumentStorageIssueListResponseSchema.parse({
      items: issues.flatMap((issue) => {
        const document = documentsByUuid.get(issue.documentUuid);
        if (!document) return [];

        return [{
          uuid: issue.uuid,
          documentUuid: issue.documentUuid,
          title: document.title,
          originalFilename: document.originalFilename,
          storageKey: document.storageKey,
          issueType: issue.issueType,
          status: issue.status,
          expectedSizeBytes: Number(issue.expectedSizeBytes),
          actualSizeBytes: issue.actualSizeBytes === null ? null : Number(issue.actualSizeBytes),
          expectedChecksumSha256: issue.expectedChecksumSha256,
          actualChecksumSha256: issue.actualChecksumSha256,
          details: issue.details,
          firstDetectedAt: issue.firstDetectedAt.toISOString(),
          lastDetectedAt: issue.lastDetectedAt.toISOString(),
          resolvedAt: issue.resolvedAt?.toISOString() ?? null
        }];
      })
    });
  }

  async exportFolder(ownerUuid: string, folderUuid: string): Promise<{ stream: Readable; filename: string }> {
    const rootFolder = await this.folders.findOwned(ownerUuid, folderUuid);
    if (!rootFolder) throw new NotFoundException('Folder not found');

    const subtree = await this.folders.listSubtree(ownerUuid, folderUuid);
    const folderUuids = subtree.map((folder) => folder.uuid);
    const links = await this.folders.listDocumentLinksForFolders(folderUuids);
    const documentUuids = [...new Set(links.map((link) => link.documentUuid))];
    const documents = await this.documents.findOwnedByUuids(ownerUuid, documentUuids);
    const documentsByUuid = new Map(documents.map((document) => [document.uuid, document]));
    const folderPaths = this.createArchiveFolderPaths(subtree, rootFolder.uuid);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const usedArchiveNames = new Set<string>();

    archive.on('error', (error: Error) => archive.destroy(error));

    for (const folder of subtree) {
      const folderPath = folderPaths.get(folder.uuid);
      if (!folderPath) continue;

      archive.append(Buffer.alloc(0), { name: folderPath + '/' });

      for (const link of links.filter((item) => item.folderUuid === folder.uuid)) {
        const document = documentsByUuid.get(link.documentUuid);
        if (!document) continue;

        if (!(await this.storage.exists(document.storageKey))) {
          throw new BadRequestException('The source file for "' + document.originalFilename + '" is not available');
        }

        const archiveFilename = this.createArchiveFilename(document, folderPath, usedArchiveNames);
        archive.file(await this.storage.resolveStoragePath(document.storageKey), {
          name: folderPath + '/' + archiveFilename
        });
      }
    }

    void archive.finalize().catch((error: unknown) => archive.destroy(error instanceof Error ? error : new Error(String(error))));

    return {
      stream: archive,
      filename: this.sanitizeArchiveSegment(rootFolder.name, 'documents') + '.zip'
    };
  }

  async exportSelected(ownerUuid: string, documentUuids: string[]): Promise<{ stream: Readable; filename: string }> {
    const documents = await this.documents.findOwnedByUuids(ownerUuid, documentUuids);
    if (documents.length === 0) {
      throw new NotFoundException('No documents found for export');
    }

    return this.createFlatArchive(documents, 'selected-documents.zip');
  }

  async exportFiltered(ownerUuid: string, query: DocumentListQuery): Promise<{ stream: Readable; filename: string }> {
    const documents = await this.documents.findOwnedAll(ownerUuid, query);
    if (documents.length === 0) {
      throw new NotFoundException('No documents match the current filters');
    }

    return this.createFlatArchive(documents, 'filtered-documents.zip');
  }

  async facets(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListFacetsResponse> {
    return DocumentListFacetsResponseSchema.parse(
      await this.documents.findOwnedFacets(ownerUuid, query)
    );
  }

  async search(ownerUuid: string, query: DocumentSearchQuery) {
    const [keywordResult, semanticResult] = await Promise.all([
      this.documents.searchOwned(ownerUuid, query),
      this.semanticSearch.search(ownerUuid, query.q, query.limit, query).catch((error: unknown) => {
        this.logger.warn(`Semantic search unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      })
    ]);
    const result = this.mergeSearchResults(keywordResult, semanticResult, query.limit);
    const documents = [...new Map(result.map((hit) => [hit.document.uuid, hit.document])).values()];
    const summaries = await this.metadata.getDocumentMetadataSummaries(ownerUuid, documents);
    return DocumentSearchResponseSchema.parse({
      query: query.q,
      total: result.length,
      items: result.map((hit) => ({
        document: this.toDocumentResponse(hit.document, summaries.get(hit.document.uuid)),
        pageNumber: hit.pageNumber,
        snippet: this.createSnippet(hit.text, query.q),
        matchType: hit.matchType,
        semanticScore: hit.semanticScore
      }))
    });
  }

  async bulkAction(ownerUuid: string, input: DocumentBulkActionInput) {
    const items = [];

    for (const uuid of input.documentUuids) {
      try {
        if (input.action === 'analyze') {
          await this.suggestTitle(ownerUuid, uuid);
        } else if (input.action === 'requeue') {
          await this.requeue(ownerUuid, uuid);
        } else {
          const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
          if (!document) {
            throw new NotFoundException('Document not found');
          }
          await this.documents.update(uuid, { isNew: false });
        }

        items.push({ uuid, success: true, message: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Bulk action failed';
        this.logger.warn(`Bulk document action failed for ${uuid}: ${message}`);
        items.push({ uuid, success: false, message: message.slice(0, 500) });
      }
    }

    return DocumentBulkActionResponseSchema.parse({
      action: input.action,
      requested: items.length,
      succeeded: items.filter((item) => item.success).length,
      failed: items.filter((item) => !item.success).length,
      items
    });
  }

  private mergeSearchResults(
    keywordResult: Array<{ document: import('../models/document.entity').Document; pageNumber: number | null; text: string; score: number }>,
    semanticResult: Array<{ document: import('../models/document.entity').Document; pageNumber: number; text: string; score: number }>,
    limit: number
  ) {
    const merged = new Map<string, {
      document: import('../models/document.entity').Document;
      pageNumber: number | null;
      text: string;
      score: number;
      semanticScore: number | null;
      matchType: 'text' | 'title' | 'semantic';
    }>();
    for (const hit of keywordResult) {
      merged.set(hit.document.uuid, {
        ...hit,
        semanticScore: null,
        matchType: hit.pageNumber === null ? 'title' : 'text'
      });
    }
    for (const hit of semanticResult) {
      const existing = merged.get(hit.document.uuid);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.document.uuid, {
          ...hit,
          semanticScore: hit.score,
          matchType: 'semantic'
        });
      } else {
        merged.set(hit.document.uuid, {
          ...existing,
          semanticScore: hit.score,
          matchType: 'semantic'
        });
      }
    }
    return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
  }

  private createArchiveFolderPaths(
    folders: Array<import('../../folder/models/folder.entity').Folder>,
    rootUuid: string
  ): Map<string, string> {
    const paths = new Map<string, string>();

    for (const folder of folders) {
      if (folder.uuid === rootUuid) {
        paths.set(folder.uuid, this.sanitizeArchiveSegment(folder.name, 'documents'));
        continue;
      }

      const parentPath = folder.parentUuid ? paths.get(folder.parentUuid) : undefined;
      if (parentPath) {
        paths.set(folder.uuid, parentPath + '/' + this.sanitizeArchiveSegment(folder.name, 'folder'));
      }
    }

    return paths;
  }

  private createArchiveFilename(
    document: import('../models/document.entity').Document,
    folderPath: string,
    usedNames: Set<string>
  ): string {
    const extension = extname(document.originalFilename).toLowerCase() || '.pdf';
    const title = document.title?.trim() || document.originalFilename.replace(/\.[^.]+$/, '');
    const safeTitle = this.sanitizeArchiveSegment(title, 'document');
    const filename = safeTitle.toLowerCase().endsWith(extension)
      ? safeTitle
      : safeTitle + extension;
    const archivePath = folderPath ? folderPath + '/' : '';
    const pathKey = (archivePath + filename).toLocaleLowerCase();

    if (!usedNames.has(pathKey)) {
      usedNames.add(pathKey);
      return filename;
    }

    const extensionStart = filename.length - extension.length;
    const base = filename.slice(0, extensionStart);
    let suffix = 2;
    let candidate = base + ' (' + suffix + ')' + extension;
    let candidateKey = (archivePath + candidate).toLocaleLowerCase();

    while (usedNames.has(candidateKey)) {
      suffix += 1;
      candidate = base + ' (' + suffix + ')' + extension;
      candidateKey = (folderPath + '/' + candidate).toLocaleLowerCase();
    }

    usedNames.add(candidateKey);
    return candidate;
  }

  private async createFlatArchive(
    documents: Array<import('../models/document.entity').Document>,
    filename: string
  ): Promise<{ stream: Readable; filename: string }> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const usedArchiveNames = new Set<string>();

    archive.on('error', (error: Error) => archive.destroy(error));

    for (const document of documents) {
      if (!(await this.storage.exists(document.storageKey))) {
        throw new BadRequestException('The source file for "' + document.originalFilename + '" is not available');
      }

      const archiveFilename = this.createArchiveFilename(document, '', usedArchiveNames);
      archive.file(await this.storage.resolveStoragePath(document.storageKey), { name: archiveFilename });
    }

    void archive.finalize().catch((error: unknown) => {
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    return { stream: archive, filename };
  }

  private sanitizeArchiveSegment(value: string, fallback: string): string {
    const sanitized = value
      .normalize('NFKC')
      .replace(/[<>:"/\\\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    return sanitized || fallback;
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
    const updated = await this.documents.update(uuid, { title: input.title, isNew: false });
    return this.toDocumentResponse(updated ?? document);
  }

  async suggestTitle(ownerUuid: string, uuid: string) {
    return this.titleSuggestions.suggest(ownerUuid, uuid);
  }

  async clearSuggestion(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    const cleared = document.aiSuggestion !== null;
    if (cleared) await this.documents.update(uuid, { aiSuggestion: null });
    return ClearDocumentSuggestionResponseSchema.parse({ cleared });
  }

  async getFile(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return { document: this.toDocumentResponse(document), stream: await this.storage.openReadStream(document.storageKey) };
  }

  async getExtractedText(ownerUuid: string, uuid: string) {
    const result = await this.documents.findOwnedPageText(ownerUuid, uuid);
    if (!result) throw new NotFoundException('Document not found');
    return DocumentExtractedTextResponseSchema.parse({
      text: result.pages.map((page) => page.text).join('\n\n'),
      pages: result.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }))
    });
  }

  async getThumbnail(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document thumbnail not found');
    }

    const thumbnailKey = await this.ensureThumbnail(document);

    return {
      document: this.toDocumentResponse(document),
      stream: await this.storage.openReadStream(thumbnailKey)
    };
  }

  private async ensureThumbnail(document: import('../models/document.entity').Document): Promise<string> {
    let thumbnailKey = document.thumbnailKey;
    if (thumbnailKey && await this.storage.exists(thumbnailKey)) return thumbnailKey;

    const activeGeneration = this.thumbnailGeneration.get(document.uuid);
    if (activeGeneration) return activeGeneration;

    const generation = this.generateThumbnail(document)
      .finally(() => this.thumbnailGeneration.delete(document.uuid));
    this.thumbnailGeneration.set(document.uuid, generation);
    return generation;
  }

  private async generateThumbnail(document: import('../models/document.entity').Document): Promise<string> {
    try {
      // Re-check after joining the in-flight map in case another request finished first.
      if (document.thumbnailKey && await this.storage.exists(document.thumbnailKey)) {
        return document.thumbnailKey;
      }

      const thumbnailKey = await this.storage.createThumbnail(document.storageKey, document.uuid);
      await this.documents.update(document.uuid, { thumbnailKey });
      document.thumbnailKey = thumbnailKey;
      return thumbnailKey;
    } catch {
      throw new NotFoundException('Document thumbnail could not be generated');
    }
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

    const updated = await this.documents.update(document.uuid, {
      status: 'uploaded',
      isNew: true,
      aiSuggestion: null
    });
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
    const metadata = await this.metadata.setDocumentMetadata(ownerUuid, uuid, input);
    if (metadata) await this.documents.update(uuid, { isNew: false });
    return metadata;
  }

  async applySuggestionToEmptyFields(ownerUuid: string, uuid: string, suggestion: DocumentTitleSuggestion): Promise<{ appliedFields: string[] }> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');

    const metadata = await this.metadata.getDocumentMetadata(ownerUuid, uuid);
    const appliedFields: string[] = [];
    const titleIsEmpty = !document.title?.trim() || document.title.trim() === document.originalFilename.trim();
    if (titleIsEmpty && suggestion.suggestedTitle.trim()) {
      await this.documents.update(uuid, { title: suggestion.suggestedTitle });
      appliedFields.push('title');
    }

    const classification: SetDocumentMetadataInput = {};
    if (!metadata.issuer && suggestion.issuerUuid) {
      classification.issuerUuid = suggestion.issuerUuid;
    }
    if (!metadata.documentType && suggestion.documentTypeUuid) {
      classification.documentTypeUuid = suggestion.documentTypeUuid;
    }
    if (!metadata.category && suggestion.categoryUuid) {
      classification.categoryUuid = suggestion.categoryUuid;
    }
    if (metadata.tags.length === 0 && suggestion.tagUuids.length > 0) {
      classification.tagUuids = suggestion.tagUuids;
    }
    if (Object.keys(classification).length > 0) {
      try {
        await this.metadata.setDocumentMetadata(ownerUuid, uuid, classification);
        if (classification.issuerUuid) appliedFields.push('issuer');
        if (classification.documentTypeUuid) appliedFields.push('documentType');
        if (classification.categoryUuid) appliedFields.push('category');
        if (classification.tagUuids) appliedFields.push('tags');
      } catch (error) {
        this.logger.warn(`Unable to auto-apply document classification for ${uuid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const newCustomValues = Object.fromEntries(Object.entries(suggestion.custom).filter(([key, value]) => {
      const current = metadata.custom[key];
      return this.isEmptyMetadataValue(current) && !this.isEmptyMetadataValue(value);
    }));
    if (Object.keys(newCustomValues).length > 0) {
      try {
        await this.metadata.setDocumentMetadata(ownerUuid, uuid, {
          custom: { ...metadata.custom, ...newCustomValues }
        });
        appliedFields.push(...Object.keys(newCustomValues).map((key) => `custom.${key}`));
      } catch (error) {
        this.logger.warn(`Unable to auto-apply custom metadata for ${uuid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { appliedFields };
  }

  private toDocumentResponse(document: import('../models/document.entity').Document, metadataSummary?: DocumentMetadataSummary): DocumentResponse {
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
      thumbnailUrl: this.thumbnailUrl(document.uuid),
      pageCount: document.pageCount || 1,
      issuerUuid: document.issuerUuid,
      isNew: document.isNew,
      metadataSummary: metadataSummary ?? { documentType: null, category: null, issuer: null, tags: [], custom: [] },
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private thumbnailUrl(uuid: string): string {
    const apiPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    return `/${apiPrefix}/documents/${uuid}/thumbnail`;
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

  private isEmptyMetadataValue(value: unknown): boolean {
    return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  }
}
