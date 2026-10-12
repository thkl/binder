import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
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
  SharedDocumentListResponseSchema,
  DocumentStorageIssueListResponseSchema,
  DocumentDeleteResponseSchema,
  DocumentVersionDeleteResponseSchema,
  ComposeDocumentInput,
  ComposeDocumentResponseSchema,
  RotateDocumentInput,
  RotateDocumentResponseSchema,
  SplitDocumentInput,
  SplitDocumentResponseSchema,
} from '@binder/common';
import {
  ClearDocumentSuggestionResponseSchema,
  DocumentExtractedTextResponseSchema,
  DocumentMetadataSummary,
  DocumentTitleSuggestion,
  SetDocumentMetadataInput,
  ClassificationFeedbackField,
} from '@binder/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import type { Readable } from 'node:stream';
import type { Express } from 'express';
import { DocumentStore } from '../store/document.store';
import { DocumentStorageService } from './document-storage.service';
import { DocumentFormatRegistry } from './document-format.registry';
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
import { DocumentAuditService } from './document-audit.service';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { Document } from '../models/document.entity';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentEmbedding } from '../models/document-embedding.entity';
import { DocumentAnalysisSession } from '../models/document-analysis-session.entity';
import { DocumentAuditEventEntity } from '../models/document-audit-event.entity';
import { DocumentMetadataChangeSet } from '../models/document-metadata-change-set.entity';
import { DocumentStorageIssue } from '../models/document-storage-issue.entity';
import { DocumentFolder } from '../../folder/models/document-folder.entity';
import {
  DocumentMetadataValue,
  DocumentTagAssignment,
} from '../../metadata/models/vocabulary.entity';
import { InboxItem } from '../../inbox/models/inbox-item.entity';
import { PipelineJob } from '../../pipeline/models/pipeline-job.entity';
import { PipelineJobEvent } from '../../pipeline/models/pipeline-job-event.entity';
import { CalendarEventStore } from '../../calendar/store/calendar-event.store';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { ClassificationFeedbackService } from '../../classification-feedback/service/classification-feedback.service';
import { IssuerService } from '../../issuer/service/issuer.service';
import { SharingService } from '../../sharing/service/sharing.service';

export interface UploadedDocumentFile {
  path: string;
  size: number;
  mimetype: string;
  originalname: string;
}

/** Coordinates document storage, metadata, search, versioning, and pipeline operations. */
@Injectable()
export class DocumentService {
  private readonly logger = new BinderLogger(DocumentService.name);
  private readonly thumbnailGeneration = new Map<string, Promise<string>>();
  private activeUploads = 0;
  private activeThumbnailGenerations = 0;
  private readonly thumbnailGenerationWaiters: Array<() => void> = [];
  private static readonly MAX_CONCURRENT_UPLOADS = 2;
  private static readonly MAX_BATCH_UPLOAD_FILES = 20;
  private static readonly MAX_BATCH_UPLOAD_BYTES = 200 * 1024 * 1024;
  private static readonly MAX_BATCH_ENTRY_BYTES = 50 * 1024 * 1024;
  private static readonly MAX_CONCURRENT_THUMBNAIL_GENERATIONS = 3;

  /**
   * Injects persistence, storage, pipeline, and feature services used by document workflows.
   *
   * @param {Sequelize} sequelize - Database connection used for transactions.
   * @param {DocumentStore} documents - Document store or service used by this operation.
   * @param {DocumentStorageService} storage - Document storage service used to read or write files.
   * @param {DocumentFormatRegistry} formats - Registry that identifies and validates uploaded content.
   * @param {PipelineService} pipeline - Pipeline service used to queue or inspect document work.
   * @param {MetadataService} metadata - Metadata service used to load or update document fields.
   * @param {SemanticSearchService} semanticSearch - Service used to run semantic document search.
   * @param {TitleSuggestionService} titleSuggestions - Existing title suggestion state to update.
   * @param {ConfigService<BinderConfig>} config - Runtime or application configuration used by this operation.
   * @param {FolderStore} folders - Folder store used to resolve folder and document links.
   * @param {DocumentStorageIssueStore} storageIssues - Store of detected storage-integrity issues.
   * @param {InboxItemStore} inboxItems - Inbox store used to queue documents for review.
   * @param {EventEmitter2} eventEmitter - Event emitter used to notify other API features.
   * @param {DocumentAuditService} audit - Audit service used to record document activity.
   * @param {CalendarEventStore} calendarEvents - Calendar event store used to look up document events.
   * @param {ApplicationSettingsService} settings - Settings service or values used by this operation.
   * @param {ClassificationFeedbackService} classificationFeedback - Service used to save classification corrections.
   * @param {IssuerService} issuers - Issuer records to compare against extracted text.
   * @param {SharingService} sharing - Sharing service used to check grants and readable resources.
   */
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly documents: DocumentStore,
    private readonly storage: DocumentStorageService,
    private readonly formats: DocumentFormatRegistry,
    private readonly pipeline: PipelineService,
    private readonly metadata: MetadataService,
    private readonly semanticSearch: SemanticSearchService,
    private readonly titleSuggestions: TitleSuggestionService,
    private readonly config: ConfigService<BinderConfig>,
    private readonly folders: FolderStore,
    private readonly storageIssues: DocumentStorageIssueStore,
    private readonly inboxItems: InboxItemStore,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: DocumentAuditService,
    private readonly calendarEvents: CalendarEventStore,
    private readonly settings: ApplicationSettingsService,
    private readonly classificationFeedback: ClassificationFeedbackService,
    private readonly issuers: IssuerService,
    private readonly sharing: SharingService,
  ) {}

  /**
   * Validates and stores a supported document, creates its record, and queues processing.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {UploadedDocumentFile} file - Uploaded file and untrusted client-supplied metadata.
   * @returns The created document after its validated source bytes are stored.
   */
  async upload(ownerUuid: string, file: UploadedDocumentFile) {
    if (!file?.path) {
      throw new BadRequestException('A supported document file is required');
    }

    if (this.activeUploads >= DocumentService.MAX_CONCURRENT_UPLOADS) {
      throw new HttpException(
        'Too many document uploads are being processed',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeUploads += 1;

    try {
      await this.storage.assertUploadSize(file.size);
      const buffer = await readFile(file.path);
      await this.storage.assertUploadSize(buffer.length);
      const detectedFormat = await this.formats.detectAndValidate(buffer);

      const uuid = randomUUID();
      const adapter = this.formats.getAdapterForMimeType(detectedFormat.mimeType, 'upload');
      const stored = await adapter.storeOriginal(
        buffer,
        uuid,
        file.originalname,
        detectedFormat.mimeType,
      );

      try {
        const duplicate = await this.documents.findByChecksum(stored.checksumSha256);
        if (duplicate) {
          const duplicateDetails: {
            code: string;
            message: string;
            documentUuid?: string;
          } = {
            code: 'DOCUMENT_DUPLICATE',
            message: 'A document with identical content already exists.',
          };

          if (duplicate.ownerUuid === ownerUuid) {
            duplicateDetails.documentUuid = duplicate.uuid;
          }

          throw new ConflictException(duplicateDetails);
        }

        const input = CreateDocumentInputSchema.parse({
          originalFilename: file.originalname,
          mimeType: detectedFormat.mimeType,
          sizeBytes: stored.sizeBytes,
          checksumSha256: stored.checksumSha256,
        });
        const malwareScanRequired = await this.isMalwareScanRequired();
        const document = await this.documents.create({
          uuid,
          ownerUuid,
          versionFamilyUuid: uuid,
          versionNumber: 1,
          versionParentUuid: null,
          title: file.originalname,
          ...input,
          storageKey: stored.storageKey,
          thumbnailKey: null,
          pageCount: 1,
          issuerUuid: null,
          isNew: true,
          status: malwareScanRequired ? 'scanning' : 'processing',
        });
        await this.recordAudit({
          documentUuid: document.uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'uploaded',
          summary: 'Document uploaded',
        });
        await this.addManualUploadToInbox(
          document.uuid,
          ownerUuid,
          file,
          stored.checksumSha256,
          stored.sizeBytes,
        );
        try {
          await this.pipeline.enqueue(
            document.uuid,
            ownerUuid,
            malwareScanRequired ? 'malware-scan' : 'text-extraction',
          );
        } catch (error) {
          this.logger.error(`Unable to enqueue document pipeline for ${document.uuid}`, error);
        }
        return this.toDocumentResponse(document);
      } catch (error) {
        await this.storage.remove(stored.storageKey).catch(() => undefined);
        throw error;
      }
    } finally {
      this.activeUploads -= 1;
    }
  }

  /**
   * Extracts a bounded, flat ZIP archive and uploads each supported file independently.
   *
   * Extraction always uses random temporary names, so archive paths never become
   * filesystem paths. Per-file failures are returned alongside successful uploads
   * so a mobile client can remove only the queue entries the server accepted.
   *
   * @param {string} ownerUuid - UUID of the authenticated document owner.
   * @param {UploadedDocumentFile} archiveFile - Uploaded ZIP archive.
   * @returns Per-entry upload outcomes in archive order, with each entry's index and filename.
   */
  async uploadArchive(ownerUuid: string, archiveFile: UploadedDocumentFile) {
    if (!archiveFile?.path) {
      throw new BadRequestException('A ZIP archive is required');
    }

    const extractionDirectory = await mkdtemp(join(tmpdir(), 'binder-api-batch-'));
    const extractedFiles: Array<{ index: number; fileName: string; path: string; size: number }> = [];
    let totalExpandedBytes = 0;

    try {
      const zipFile = await yauzl.openPromise(archiveFile.path, {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      });

      try {
        if (zipFile.entryCount > DocumentService.MAX_BATCH_UPLOAD_FILES) {
          throw new BadRequestException(
            `A ZIP archive can contain at most ${DocumentService.MAX_BATCH_UPLOAD_FILES} documents`,
          );
        }
        for await (const entry of zipFile.eachEntry()) {
          const fileName = entry.fileName;
          const unixFileType = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (unixFileType === 0o120000) {
            throw new BadRequestException('ZIP archives cannot contain symbolic links');
          }

          if (fileName.endsWith('/')) {
            throw new BadRequestException('ZIP archives must contain flat files only');
          }

          if (
            !fileName || fileName.length > 255 || basename(fileName) !== fileName ||
            fileName.includes('\\') || /[\u0000-\u001f\u007f]/u.test(fileName)
          ) {
            throw new BadRequestException('ZIP entries must use safe, flat filenames');
          }
          if (unixFileType !== 0 && unixFileType !== 0o100000) {
            throw new BadRequestException('ZIP archives can contain regular files only');
          }
          if (entry.isEncrypted() || !entry.canDecodeFileData()) {
            throw new BadRequestException(`The ZIP entry '${fileName}' is encrypted or unsupported`);
          }
          if (![0, 8].includes(entry.compressionMethod)) {
            throw new BadRequestException(`The ZIP entry '${fileName}' uses unsupported compression`);
          }
          if (entry.uncompressedSize <= 0 || entry.uncompressedSize > DocumentService.MAX_BATCH_ENTRY_BYTES) {
            throw new BadRequestException(`The ZIP entry '${fileName}' exceeds the per-document size limit`);
          }
          if (entry.compressedSize < 0 || entry.uncompressedSize < 0) {
            throw new BadRequestException(`The ZIP entry '${fileName}' has invalid size metadata`);
          }

          if (extractedFiles.length >= DocumentService.MAX_BATCH_UPLOAD_FILES) {
            throw new BadRequestException(
              `A ZIP archive can contain at most ${DocumentService.MAX_BATCH_UPLOAD_FILES} documents`,
            );
          }

          const destinationPath = join(extractionDirectory, randomUUID());
          const input = await zipFile.openReadStreamPromise(entry);
          let entryBytes = 0;
          const sizeGuard = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              entryBytes += chunk.length;
              totalExpandedBytes += chunk.length;
              if (entryBytes > DocumentService.MAX_BATCH_ENTRY_BYTES) {
                callback(new BadRequestException(`The ZIP entry '${fileName}' exceeds the per-document size limit`));
              } else if (totalExpandedBytes > DocumentService.MAX_BATCH_UPLOAD_BYTES) {
                callback(new BadRequestException('The ZIP archive exceeds the expanded size limit'));
              } else {
                callback(null, chunk);
              }
            },
          });

          try {
            await pipeline(input, sizeGuard, createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }));
          } catch (error) {
            await rm(destinationPath, { force: true }).catch(() => undefined);
            throw error;
          }

          const fileStat = await stat(destinationPath);
          if (fileStat.size !== entry.uncompressedSize) {
            throw new BadRequestException(`The ZIP entry '${fileName}' has inconsistent size metadata`);
          }
          extractedFiles.push({ index: extractedFiles.length, fileName, path: destinationPath, size: fileStat.size });
          if (totalExpandedBytes > DocumentService.MAX_BATCH_UPLOAD_BYTES) {
            throw new BadRequestException('The ZIP archive exceeds the expanded size limit');
          }
        }
      } finally {
        zipFile.close();
      }

      if (extractedFiles.length === 0) {
        throw new BadRequestException('The ZIP archive contains no documents');
      }

      const items: Array<{ index: number; fileName: string; success: boolean; message?: string }> = [];
      for (const file of extractedFiles) {
        try {
          await this.upload(ownerUuid, {
            path: file.path,
            size: file.size,
            mimetype: 'application/octet-stream',
            originalname: file.fileName,
          });
          items.push({ index: file.index, fileName: file.fileName, success: true });
        } catch (error) {
          if (!(error instanceof HttpException)) {
            this.logger.error(`Batch upload failed for ZIP entry '${file.fileName}'`, error);
          }
          const response = error instanceof HttpException ? error.getResponse() : undefined;
          const message = typeof response === 'string'
            ? response
            : typeof response === 'object' && response !== null && 'message' in response
              ? String(response.message)
              : 'The document could not be uploaded';
          items.push({ index: file.index, fileName: file.fileName, success: false, message: message.slice(0, 300) });
        }
      }

      return { items };
    } finally {
      await rm(extractionDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Adds a split/composed PDF to the inbox using the same flow as a manual upload.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {{ originalname: string; buffer?: Buffer; mimetype?: string }} file - PDF or other file supplied for this operation.
   * @param {string} checksumSha256 - SHA-256 checksum of the file contents.
   * @param {number} sizeBytes - Size of the file in bytes.
   * @param {boolean} autoApplyAi - Whether AI suggestions should be applied automatically.
   * @param {boolean | null} aiAutoApplyOverride - Optional override for automatically applying AI suggestions.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async addManualUploadToInbox(
    documentUuid: string,
    ownerUuid: string,
    file: { originalname: string; buffer?: Buffer; mimetype?: string },
    checksumSha256: string,
    sizeBytes: number,
    autoApplyAi = false,
    aiAutoApplyOverride: boolean | null = null,
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
        autoApplyAi,
        aiAutoApplyOverride,
        lastError: null,
        aiError: null,
      });
      this.eventEmitter.emit('inbox.changed', {
        reason: 'manual-upload',
        documentUuids: [documentUuid],
      });
    } catch (error) {
      this.logger.error(
        `Unable to add manually uploaded document ${documentUuid} to the inbox`,
        error,
      );
    }
  }

  /**
   * Returns a paginated, filtered document list for one owner.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {DocumentListQuery} query - Validated search or document-list criteria.
   * @returns {Promise<DocumentListResponse>} - A paginated, filtered document list for one owner.
   */
  async list(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListResponse> {
    const result = await this.documents.findOwnedPage(ownerUuid, query);
    const summaries = await this.metadata.getDocumentMetadataSummaries(ownerUuid, result.items);
    const calendarDocuments = await this.calendarEvents.findOwnedDocumentUuids(
      ownerUuid,
      result.items.map((document) => document.uuid),
    );
    return DocumentListResponseSchema.parse({
      ...result,
      groupBy: query.groupBy,
      items: result.items.map((document) =>
        this.toDocumentResponse(
          document,
          summaries.get(document.uuid),
          calendarDocuments.has(document.uuid) ? this.calendarUrl(document.uuid) : null,
        ),
      ),
    });
  }

  /**
   * Lists storage inconsistencies that need administrator attention.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @returns Lists storage inconsistencies that need administrator attention.
   */
  async listStorageIssues(ownerUuid: string) {
    const issues = await this.storageIssues.findOpenOwned(ownerUuid);
    const documents = await this.documents.findOwnedByUuids(
      ownerUuid,
      issues.map((issue) => issue.documentUuid),
    );
    const documentsByUuid = new Map(documents.map((document) => [document.uuid, document]));

    return DocumentStorageIssueListResponseSchema.parse({
      items: issues.flatMap((issue) => {
        const document = documentsByUuid.get(issue.documentUuid);
        if (!document) return [];

        return [
          {
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
            resolvedAt: issue.resolvedAt?.toISOString() ?? null,
          },
        ];
      }),
    });
  }

  /**
   * Builds a ZIP archive for all documents contained in a folder subtree.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} folderUuid - UUID of the folder.
   * @returns {Promise<{ stream: Readable; filename: string }>} - Builds a ZIP archive for all documents contained in a folder subtree.
   */
  async exportFolder(
    ownerUuid: string,
    folderUuid: string,
  ): Promise<{ stream: Readable; filename: string }> {
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
        this.assertDocumentContentAvailable(document);

        if (!(await this.storage.exists(document.storageKey))) {
          throw new BadRequestException(
            'The source file for "' + document.originalFilename + '" is not available',
          );
        }

        const archiveFilename = this.createArchiveFilename(document, folderPath, usedArchiveNames);
        archive.file(await this.storage.resolveStoragePath(document.storageKey), {
          name: folderPath + '/' + archiveFilename,
        });
      }
    }

    await this.recordExportAudit(ownerUuid, documents, `Folder '${rootFolder.name}' exported`);

    void archive
      .finalize()
      .catch((error: unknown) =>
        archive.destroy(error instanceof Error ? error : new Error(String(error))),
      );

    return {
      stream: archive,
      filename: this.sanitizeArchiveSegment(rootFolder.name, 'documents') + '.zip',
    };
  }

  /**
   * Builds a ZIP archive for a validated set of selected documents.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @returns {Promise<{ stream: Readable; filename: string }>} - Builds a ZIP archive for a validated set of selected documents.
   */
  async exportSelected(
    ownerUuid: string,
    documentUuids: string[],
  ): Promise<{ stream: Readable; filename: string }> {
    const documents = await this.documents.findOwnedByUuids(ownerUuid, documentUuids);
    if (documents.length === 0) {
      throw new NotFoundException('No documents found for export');
    }

    documents.forEach((document) => this.assertDocumentContentAvailable(document));
    const archive = await this.createFlatArchive(documents, 'selected-documents.zip');
    await this.recordExportAudit(ownerUuid, documents, 'Selected documents exported');
    return archive;
  }

  /**
   * Builds a ZIP archive for all documents matching the supplied list filters.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {DocumentListQuery} query - Validated search or document-list criteria.
   * @returns {Promise<{ stream: Readable; filename: string }>} - Builds a ZIP archive for all documents matching the supplied list filters.
   */
  async exportFiltered(
    ownerUuid: string,
    query: DocumentListQuery,
  ): Promise<{ stream: Readable; filename: string }> {
    const documents = await this.documents.findOwnedAll(ownerUuid, query);
    if (documents.length === 0) {
      throw new NotFoundException('No documents match the current filters');
    }

    documents.forEach((document) => this.assertDocumentContentAvailable(document));
    const archive = await this.createFlatArchive(documents, 'filtered-documents.zip');
    await this.recordExportAudit(ownerUuid, documents, 'Filtered documents exported');
    return archive;
  }

  /**
   * Computes available filter counts for the current owner and list query.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {DocumentListQuery} query - Validated search or document-list criteria.
   * @returns {Promise<DocumentListFacetsResponse>} - Computes available filter counts for the current owner and list query.
   */
  async facets(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListFacetsResponse> {
    return DocumentListFacetsResponseSchema.parse(
      await this.documents.findOwnedFacets(ownerUuid, query),
    );
  }

  /**
   * Searches document text and metadata within the owner's accessible records.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {DocumentSearchQuery} query - Validated search or document-list criteria.
   * @returns Searches document text and metadata within the owner's accessible records.
   */
  async search(ownerUuid: string, query: DocumentSearchQuery) {
    const [keywordResult, semanticResult] = await Promise.all([
      this.documents.searchOwned(ownerUuid, query),
      this.semanticSearch.search(ownerUuid, query.q, query.limit, query).catch((error: unknown) => {
        this.logger.warn(
          `Semantic search unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }),
    ]);
    const result = this.mergeSearchResults(keywordResult, semanticResult, query.limit);
    const documents = [...new Map(result.map((hit) => [hit.document.uuid, hit.document])).values()];
    const summaries = await this.metadata.getDocumentMetadataSummaries(ownerUuid, documents);
    const calendarDocuments = await this.calendarEvents.findOwnedDocumentUuids(
      ownerUuid,
      documents.map((document) => document.uuid),
    );
    return DocumentSearchResponseSchema.parse({
      query: query.q,
      total: result.length,
      items: result.map((hit) => ({
        document: this.toDocumentResponse(
          hit.document,
          summaries.get(hit.document.uuid),
          calendarDocuments.has(hit.document.uuid) ? this.calendarUrl(hit.document.uuid) : null,
        ),
        pageNumber: hit.pageNumber,
        snippet: this.createSnippet(hit.text, query.q),
        matchType: hit.matchType,
        semanticScore: hit.semanticScore,
      })),
    });
  }

  /**
   * Lists documents shared directly or through folders with the current user.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @returns Lists documents shared directly or through folders with the current user.
   */
  async listShared(ownerUuid: string) {
    const grants = await this.sharing.listReceivedDocumentGrants(ownerUuid);
    return this.sharedDocumentResponse([...grants.keys()], grants);
  }

  /**
   * Lists directly shared documents that are not included in a shared folder.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @returns Lists directly shared documents that are not included in a shared folder.
   */
  async listSharedUnfiled(ownerUuid: string) {
    const [documentUuids, grants] = await Promise.all([
      this.sharing.listReceivedUnfiledDocumentUuids(ownerUuid),
      this.sharing.listReceivedDocumentGrants(ownerUuid),
    ]);
    return this.sharedDocumentResponse(documentUuids, grants);
  }

  /**
   * Lists documents visible through a shared folder, including descendant folders.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} folderUuid - UUID of the folder.
   * @returns Lists documents visible through a shared folder, including descendant folders.
   */
  async listSharedFolderDocuments(ownerUuid: string, folderUuid: string) {
    const [documentUuids, grants] = await Promise.all([
      this.sharing.listReceivedFolderDocumentUuids(ownerUuid, folderUuid),
      this.sharing.listReceivedDocumentGrants(ownerUuid),
    ]);
    return this.sharedDocumentResponse(documentUuids, grants);
  }

  /**
   * Shapes a shared document using only metadata available to its recipient.
   *
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @param {Map<string, Date>} grants - Share grants used to build the recipient response.
   * @returns Shapes a shared document using only metadata available to its recipient.
   */
  private async sharedDocumentResponse(documentUuids: string[], grants: Map<string, Date>) {
    const documents = await this.documents.findAccessibleCandidates(documentUuids);
    documents.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return SharedDocumentListResponseSchema.parse({
      items: documents.flatMap((document) => {
        const sharedAt = grants.get(document.uuid);
        return sharedAt
          ? [
              {
                document: this.toSharedDocumentResponse(document),
                sharedAt: sharedAt.toISOString(),
              },
            ]
          : [];
      }),
    });
  }

  /**
   * Returns a cache token representing the latest change visible to the owner.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @returns {Promise<{ token: string; updatedAt: Date | null }>} - A cache token representing the latest change visible to the owner.
   */
  async documentChangeToken(ownerUuid: string): Promise<{ token: string; updatedAt: Date | null }> {
    return this.documents.changeToken(ownerUuid);
  }

  /**
   * Lists visible document IDs changed after the supplied timestamp.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {Date} since - Timestamp used as the lower bound for change lookup.
   * @returns {Promise<string[]>} - Lists visible document IDs changed after the supplied timestamp.
   */
  async changedDocumentUuidsSince(ownerUuid: string, since: Date): Promise<string[]> {
    return this.documents.findChangedUuidsSince(ownerUuid, since);
  }

  /**
   * Applies a supported bulk action to owned documents and records its audit change set.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {DocumentBulkActionInput} input - Validated input describing the requested operation.
   * @returns Applies a supported bulk action to owned documents and records its audit change set.
   */
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
          const wasNew = document.isNew;
          const updated = await this.documents.update(uuid, { isNew: false });
          if (wasNew && updated?.isNew === false) {
            this.eventEmitter.emit('inbox.changed', {
              reason: 'document-reviewed',
              documentUuids: [uuid],
            });
            await this.recordAudit({
              documentUuid: uuid,
              ownerUuid,
              actorUuid: ownerUuid,
              actorType: 'user',
              eventType: 'metadata-changed',
              summary: 'Document marked as reviewed',
              details: { fields: ['reviewState'] },
            });
          }
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
      items,
    });
  }

  /**
   * Merges lexical and semantic matches while preserving the best score per document.
   *
   * @param {Array<{
   * document: import('../models/document.entity').Document;
   * pageNumber: number | null;
   * text: string;
   * score: number;
   * matchType: 'text' | 'title';
   * }>} keywordResult - Results from the lexical keyword search.
   * @param {Array<{
   * document: import('../models/document.entity').Document;
   * pageNumber: number | null;
   * text: string;
   * score: number;
   * }>} semanticResult - Results from the semantic similarity search.
   * @param {number} limit - Maximum number of results to return.
   * @returns Merges lexical and semantic matches while preserving the best score per document.
   */
  private mergeSearchResults(
    keywordResult: Array<{
      document: import('../models/document.entity').Document;
      pageNumber: number | null;
      text: string;
      score: number;
      matchType: 'text' | 'title';
    }>,
    semanticResult: Array<{
      document: import('../models/document.entity').Document;
      pageNumber: number | null;
      text: string;
      score: number;
    }>,
    limit: number,
  ) {
    const merged = new Map<
      string,
      {
        document: import('../models/document.entity').Document;
        pageNumber: number | null;
        text: string;
        score: number;
        semanticScore: number | null;
        matchType: 'text' | 'title' | 'semantic';
      }
    >();
    for (const hit of keywordResult) {
      merged.set(hit.document.uuid, {
        ...hit,
        semanticScore: null,
        matchType: hit.matchType,
      });
    }
    for (const hit of semanticResult) {
      const existing = merged.get(hit.document.uuid);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.document.uuid, {
          ...hit,
          semanticScore: hit.score,
          matchType: 'semantic',
        });
      } else {
        merged.set(hit.document.uuid, {
          ...existing,
          semanticScore: hit.score,
          matchType: 'semantic',
        });
      }
    }
    return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
  }

  /**
   * Maps archived document IDs to their relative folder paths.
   *
   * @param {Array<import('../../folder/models/folder.entity').Folder>} folders - Folder store used to resolve folder and document links.
   * @param {string} rootUuid - UUID of the root folder for path construction.
   * @returns {Map<string, string>} - Maps archived document IDs to their relative folder paths.
   */
  private createArchiveFolderPaths(
    folders: Array<import('../../folder/models/folder.entity').Folder>,
    rootUuid: string,
  ): Map<string, string> {
    const paths = new Map<string, string>();

    for (const folder of folders) {
      if (folder.uuid === rootUuid) {
        paths.set(folder.uuid, this.sanitizeArchiveSegment(folder.name, 'documents'));
        continue;
      }

      const parentPath = folder.parentUuid ? paths.get(folder.parentUuid) : undefined;
      if (parentPath) {
        paths.set(
          folder.uuid,
          parentPath + '/' + this.sanitizeArchiveSegment(folder.name, 'folder'),
        );
      }
    }

    return paths;
  }

  /**
   * Generates a collision-safe filename for one document inside a ZIP archive.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @param {string} folderPath - Relative folder path to use inside the archive.
   * @param {Set<string>} usedNames - Archive paths already taken, used to avoid filename collisions.
   * @returns {string} - Generates a collision-safe filename for one document inside a ZIP archive.
   */
  private createArchiveFilename(
    document: import('../models/document.entity').Document,
    folderPath: string,
    usedNames: Set<string>,
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

  /**
   * Streams documents into a ZIP archive with safe paths and source-file checks.
   *
   * @param {Array<import('../models/document.entity').Document>} documents - Document store or service used by this operation.
   * @param {string} filename - Source or destination filename for the file operation.
   * @returns {Promise<{ stream: Readable; filename: string }>} - Streams documents into a ZIP archive with safe paths and source-file checks.
   */
  private async createFlatArchive(
    documents: Array<import('../models/document.entity').Document>,
    filename: string,
  ): Promise<{ stream: Readable; filename: string }> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const usedArchiveNames = new Set<string>();

    archive.on('error', (error: Error) => archive.destroy(error));

    for (const document of documents) {
      if (!(await this.storage.exists(document.storageKey))) {
        throw new BadRequestException(
          'The source file for "' + document.originalFilename + '" is not available',
        );
      }

      this.assertDocumentContentAvailable(document);

      const archiveFilename = this.createArchiveFilename(document, '', usedArchiveNames);
      archive.file(await this.storage.resolveStoragePath(document.storageKey), {
        name: archiveFilename,
      });
    }

    void archive.finalize().catch((error: unknown) => {
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    return { stream: archive, filename };
  }

  /**
   * Removes path separators and unsafe characters from one archive path segment.
   *
   * @param {string} value - Value to store, parse, or compare.
   * @param {string} fallback - Fallback value used when the configured value is missing.
   * @returns {string} - Removes path separators and unsafe characters from one archive path segment.
   */
  private sanitizeArchiveSegment(value: string, fallback: string): string {
    const sanitized = value
      .normalize('NFKC')
      .replace(/[<>:"/\\\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    return sanitized || fallback;
  }

  /**
   * Returns one document when it is owned by or shared with the requesting user.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns One document when it is owned by or shared with the requesting user.
   */
  async get(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);
    const isOwner = document.ownerUuid === ownerUuid;
    const [summaries, calendarEvent] = await Promise.all([
      isOwner
        ? this.metadata.getDocumentMetadataSummaries(ownerUuid, [document])
        : Promise.resolve(new Map()),
      isOwner ? this.calendarEvents.findOwnedByDocument(ownerUuid, uuid) : Promise.resolve(null),
    ]);
    if (!isOwner) return this.toSharedDocumentResponse(document);
    return this.toDocumentResponse(
      document,
      summaries.get(uuid),
      calendarEvent ? this.calendarUrl(uuid) : null,
    );
  }

  /**
   * Deletes an owned document and its related storage and metadata records.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Deletes an owned document and its related storage and metadata records.
   */
  async remove(
    ownerUuid: string,
    uuid: string,
    versionReparent?: { nextParentUuid: string | null; promoteUuid?: string },
  ) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.sequelize.transaction(async (transaction) => {
      const jobs = await PipelineJob.findAll({
        attributes: ['uuid'],
        where: { documentUuid: uuid },
        transaction,
      });
      const jobUuids = jobs.map((job) => job.uuid);

      if (jobUuids.length > 0) {
        await PipelineJobEvent.destroy({
          where: { jobUuid: { [Op.in]: jobUuids } },
          transaction,
        });
      }

      await PipelineJob.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentTagAssignment.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentMetadataValue.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentFolder.destroy({ where: { documentUuid: uuid }, transaction });
      await InboxItem.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentPage.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentEmbedding.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentAnalysisSession.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentStorageIssue.destroy({ where: { documentUuid: uuid }, transaction });
      await DocumentAuditEventEntity.destroy({ where: { documentUuid: uuid }, transaction });
      await this.removeDocumentFromChangeSets(ownerUuid, uuid, transaction);
      if (versionReparent?.promoteUuid) {
        await this.documents.setVersionParent(
          ownerUuid,
          versionReparent.promoteUuid,
          null,
          transaction,
        );
        await this.documents.reparentVersionChildren(
          ownerUuid,
          uuid,
          versionReparent.promoteUuid,
          transaction,
          versionReparent.promoteUuid,
        );
      } else if (versionReparent) {
        await this.documents.reparentVersionChildren(
          ownerUuid,
          uuid,
          versionReparent.nextParentUuid,
          transaction,
        );
      }
      await document.destroy({ transaction });
    });

    this.thumbnailGeneration.delete(uuid);
    const filesToRemove = [document.storageKey, document.thumbnailKey, document.archiveKey].filter(
      (key): key is string => Boolean(key),
    );
    await Promise.all(
      filesToRemove.map((key) =>
        this.storage
          .remove(key)
          .catch((error: unknown) =>
            this.logger.warn(
              `Unable to remove deleted document file ${key}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
      ),
    );
    await this.storage
      .removeDerived(uuid, document.createdAt)
      .catch((error: unknown) =>
        this.logger.warn(
          `Unable to remove derived files for deleted document ${uuid}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    this.eventEmitter.emit('inbox.changed', { reason: 'document-deleted' });

    return DocumentDeleteResponseSchema.parse({ deleted: true, uuid });
  }

  /**
   * Removes references to a deleted document from stored bulk change sets.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} documentUuid - UUID of the document.
   * @param {import('sequelize').Transaction} transaction - Database transaction for related writes.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async removeDocumentFromChangeSets(
    ownerUuid: string,
    documentUuid: string,
    transaction: import('sequelize').Transaction,
  ): Promise<void> {
    const changeSets = await DocumentMetadataChangeSet.findAll({
      where: { ownerUuid },
      transaction,
    });

    for (const changeSet of changeSets) {
      const changes = changeSet.changes.filter(
        (change) => (change as { documentUuid?: unknown }).documentUuid !== documentUuid,
      );
      if (changes.length === changeSet.changes.length) continue;

      if (changes.length === 0) {
        await changeSet.destroy({ transaction });
        continue;
      }

      await changeSet.update(
        {
          documentCount: changes.length,
          changes,
        },
        { transaction },
      );
    }
  }

  /**
   * Updates a document's title and writes the corresponding audit event.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {SetDocumentTitleInput} input - Validated input describing the requested operation.
   * @returns Updates a document's title and writes the corresponding audit event.
   */
  async updateTitle(ownerUuid: string, uuid: string, input: SetDocumentTitleInput) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    const changed = document.title !== input.title;
    const clearNewMarker = await this.shouldClearNewMarkerOnMetadataSave();
    const reviewStateChanged = clearNewMarker && document.isNew;
    const updated = await this.documents.update(uuid, {
      title: input.title,
      ...(clearNewMarker ? { isNew: false } : {}),
    });
    if (changed || reviewStateChanged) {
      this.eventEmitter.emit('inbox.changed', {
        reason: 'document-reviewed',
        documentUuids: [uuid],
      });
    }
    if (changed) {
      await this.recordAudit({
        documentUuid: uuid,
        ownerUuid,
        actorUuid: ownerUuid,
        actorType: 'user',
        eventType: 'title-changed',
        summary: 'Document title changed',
        details: { fields: reviewStateChanged ? ['title', 'reviewState'] : ['title'] },
      });
    } else if (reviewStateChanged) {
      await this.recordAudit({
        documentUuid: uuid,
        ownerUuid,
        actorUuid: ownerUuid,
        actorType: 'user',
        eventType: 'metadata-changed',
        summary: 'Document marked as reviewed after title save',
        details: { fields: ['reviewState'] },
      });
    }
    return this.toDocumentResponse(updated ?? document);
  }

  /**
   * Lists the version family containing a document owned by the caller.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Lists the version family containing a document owned by the caller.
   */
  async listVersions(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');

    return {
      items: await Promise.all(
        (await this.documents.findOwnedVersionFamily(ownerUuid, document.versionFamilyUuid)).map(
          async (version) => this.toDocumentResponse(version),
        ),
      ),
    };
  }

  /**
   * Deletes a version and promotes the preceding version when the current version is removed.
   *
   * @param {string} ownerUuid - UUID of the authenticated document owner.
   * @param {string} uuid - UUID of the version to remove.
   * @returns Resolves with the deleted identifier and the remaining current document.
   */
  async removeVersion(ownerUuid: string, uuid: string) {
    const version = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!version) throw new NotFoundException('Document version not found');

    const family = await this.documents.findOwnedVersionFamily(
      ownerUuid,
      version.versionFamilyUuid,
    );
    if (family.length <= 1) {
      throw new ConflictException('The only version in a document family cannot be removed');
    }

    let versionReparent: { nextParentUuid: string | null; promoteUuid?: string };
    if (version.versionParentUuid === null) {
      const precedingVersion =
        family
          .filter((candidate) => candidate.versionParentUuid === version.uuid)
          .sort((left, right) => right.versionNumber - left.versionNumber)[0] ??
        family
          .filter((candidate) => candidate.uuid !== version.uuid)
          .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      if (!precedingVersion) {
        throw new ConflictException('There is no previous version to promote');
      }
      versionReparent = { nextParentUuid: null, promoteUuid: precedingVersion.uuid };
    } else {
      versionReparent = { nextParentUuid: version.versionParentUuid };
    }

    await this.remove(ownerUuid, uuid, versionReparent);
    const remainingVersions = await this.documents.findOwnedVersionFamily(
      ownerUuid,
      version.versionFamilyUuid,
    );
    const currentDocument =
      remainingVersions.find((candidate) => candidate.versionParentUuid === null) ??
      remainingVersions.sort((left, right) => right.versionNumber - left.versionNumber)[0];
    if (!currentDocument) throw new ConflictException('No document version remains after deletion');

    return DocumentVersionDeleteResponseSchema.parse({
      deleted: true,
      uuid,
      currentDocument: this.toDocumentResponse(currentDocument),
    });
  }

  /**
   * Assigns a document to another document's version family, optionally copying metadata.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} targetUuid - UUID of the target document.
   * @param {boolean} copyMetadata - Whether metadata should be copied to the resulting document.
   * @returns Assigns a document to another document's version family, optionally copying metadata.
   */
  async assignAsVersion(ownerUuid: string, uuid: string, targetUuid: string, copyMetadata = false) {
    if (uuid === targetUuid) {
      throw new BadRequestException('A document cannot be a version of itself');
    }

    const [source, target] = await Promise.all([
      this.documents.findOwnedByUuid(ownerUuid, uuid),
      this.documents.findOwnedByUuid(ownerUuid, targetUuid),
    ]);
    if (!source || !target) throw new NotFoundException('Document not found');

    const family = await this.documents.findOwnedVersionFamily(ownerUuid, target.versionFamilyUuid);
    const nextVersion = Math.max(...family.map((version) => version.versionNumber), 0) + 1;
    const updated = await this.documents.promoteVersion(
      source.uuid,
      target.uuid,
      target.versionFamilyUuid,
      nextVersion,
    );
    if (!updated) throw new NotFoundException('Document not found');

    if (copyMetadata) {
      const sourceMetadata = await this.metadata.getDocumentMetadata(ownerUuid, target.uuid);
      await this.metadata.setDocumentMetadata(ownerUuid, updated.uuid, {
        issuerUuid: sourceMetadata.issuer?.uuid ?? null,
        documentTypeUuid: sourceMetadata.documentType?.uuid ?? null,
        categoryUuid: sourceMetadata.category?.uuid ?? null,
        tagUuids: sourceMetadata.tags.map((tag) => tag.uuid),
        custom: sourceMetadata.custom,
      });
      const sourceFolders = await this.folders.listForDocument(ownerUuid, target.uuid);
      await Promise.all(
        sourceFolders.map((folder) => this.folders.createLinks(folder.uuid, [updated.uuid])),
      );
    }

    await this.recordAudit({
      documentUuid: updated.uuid,
      ownerUuid,
      actorUuid: ownerUuid,
      actorType: 'user',
      eventType: 'version-assigned',
      summary: `Document assigned as version ${nextVersion}`,
      details: {
        targetDocumentUuid: target.uuid,
        versionNumber: nextVersion,
        copiedMetadata: copyMetadata,
      },
    });

    return this.toDocumentResponse(updated);
  }

  /**
   * Splits a PDF into two documents and queues processing for both new files.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {SplitDocumentInput} input - Validated input describing the requested operation.
   * @returns Splits a PDF into two documents and queues processing for both new files.
   */
  async split(ownerUuid: string, uuid: string, input: SplitDocumentInput) {
    this.logger.info('Splitting document', {
      documentUuid: uuid,
      ownerUuid,
      splitAfterPage: input.splitAfterPage,
      autoApplySuggestions: input.autoApplySuggestions,
    });
    const original = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!original) throw new NotFoundException('Document not found');
    this.assertDocumentContentAvailable(original);
    if (original.pageCount === null) {
      throw new BadRequestException('The document has no physical pages to split');
    }

    const adapter = this.formats.getAdapterForMimeType(original.mimeType, 'split');
    const [remainingBuffer, extractedBuffer] = await adapter.split(
      original.storageKey,
      input.splitAfterPage,
    );
    const remainingUuid = randomUUID();
    const extractedUuid = randomUUID();
    const remainingName = this.splitFilename(original.originalFilename, 'remaining');
    const extractedName = this.splitFilename(
      original.originalFilename,
      `pages-${input.splitAfterPage + 1}-to-${original.pageCount}`,
    );
    const [remainingStored, extractedStored] = await Promise.all([
      adapter.storeOriginal(remainingBuffer, remainingUuid, remainingName),
      adapter.storeOriginal(extractedBuffer, extractedUuid, extractedName),
    ]);
    // Persist both output files before creating database rows so no document
    // can become visible with only one half of the split PDF available.
    const malwareScanRequired = await this.isMalwareScanRequired();
    const family = await this.documents.findOwnedVersionFamily(
      ownerUuid,
      original.versionFamilyUuid,
    );
    const nextVersion = Math.max(...family.map((version) => version.versionNumber), 0) + 1;

    // Track record creation so the failure handler can clean up files without
    // deleting storage that a committed document row now references.
    let documentsCreated = false;
    try {
      const remaining = await this.documents.create({
        uuid: remainingUuid,
        ownerUuid,
        versionFamilyUuid: original.versionFamilyUuid,
        versionNumber: nextVersion,
        versionParentUuid: null,
        title: original.title,
        originalFilename: remainingName,
        mimeType: adapter.descriptor.mimeTypes[0]!,
        sizeBytes: remainingStored.sizeBytes,
        checksumSha256: remainingStored.checksumSha256,
        storageKey: remainingStored.storageKey,
        thumbnailKey: null,
        pageCount: input.splitAfterPage,
        issuerUuid: original.issuerUuid,
        isNew: true,
        status: malwareScanRequired ? 'scanning' : 'processing',
      });
      documentsCreated = true;
      const extracted = await this.documents.create({
        uuid: extractedUuid,
        ownerUuid,
        versionFamilyUuid: extractedUuid,
        versionNumber: 1,
        versionParentUuid: null,
        title: original.title,
        originalFilename: extractedName,
        mimeType: adapter.descriptor.mimeTypes[0]!,
        sizeBytes: extractedStored.sizeBytes,
        checksumSha256: extractedStored.checksumSha256,
        storageKey: extractedStored.storageKey,
        thumbnailKey: null,
        pageCount: original.pageCount - input.splitAfterPage,
        issuerUuid: original.issuerUuid,
        isNew: true,
        status: malwareScanRequired ? 'scanning' : 'processing',
      });

      await this.documents.update(original.uuid, { versionParentUuid: remaining.uuid });
      const sourceMetadata = await this.metadata.getDocumentMetadata(ownerUuid, original.uuid);
      const metadataInput = {
        issuerUuid: sourceMetadata.issuer?.uuid ?? null,
        documentTypeUuid: sourceMetadata.documentType?.uuid ?? null,
        categoryUuid: sourceMetadata.category?.uuid ?? null,
        tagUuids: sourceMetadata.tags.map((tag) => tag.uuid),
        custom: sourceMetadata.custom,
      };
      await Promise.all([
        this.metadata.setDocumentMetadata(ownerUuid, remaining.uuid, metadataInput),
        this.metadata.setDocumentMetadata(ownerUuid, extracted.uuid, metadataInput),
      ]);
      const sourceFolders = await this.folders.listForDocument(ownerUuid, original.uuid);
      await Promise.all(
        sourceFolders.flatMap((folder) => [
          this.folders.createLinks(folder.uuid, [remaining.uuid]),
          this.folders.createLinks(folder.uuid, [extracted.uuid]),
        ]),
      );

      await Promise.all([
        this.addManualUploadToInbox(
          remaining.uuid,
          ownerUuid,
          {
            buffer: remainingBuffer,
            mimetype: adapter.descriptor.mimeTypes[0]!,
            originalname: remainingName,
          },
          remainingStored.checksumSha256,
          remainingStored.sizeBytes,
          input.autoApplySuggestions,
          input.autoApplySuggestions,
        ),
        this.addManualUploadToInbox(
          extracted.uuid,
          ownerUuid,
          {
            buffer: extractedBuffer,
            mimetype: adapter.descriptor.mimeTypes[0]!,
            originalname: extractedName,
          },
          extractedStored.checksumSha256,
          extractedStored.sizeBytes,
          input.autoApplySuggestions,
          input.autoApplySuggestions,
        ),
      ]);
      await Promise.all([
        this.pipeline.enqueue(
          remaining.uuid,
          ownerUuid,
          malwareScanRequired ? 'malware-scan' : 'text-extraction',
        ),
        this.pipeline.enqueue(
          extracted.uuid,
          ownerUuid,
          malwareScanRequired ? 'malware-scan' : 'text-extraction',
        ),
      ]);
      await Promise.all([
        this.recordAudit({
          documentUuid: remaining.uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'document-split',
          summary: 'Document split; remaining pages became a new version',
          details: {
            sourceDocumentUuid: original.uuid,
            extractedDocumentUuid: extracted.uuid,
            splitAfterPage: input.splitAfterPage,
            autoApplySuggestions: input.autoApplySuggestions,
          },
        }),
        this.recordAudit({
          documentUuid: extracted.uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'document-split',
          summary: 'Document split; pages became a new document',
          details: {
            sourceDocumentUuid: original.uuid,
            remainingDocumentUuid: remaining.uuid,
            splitAfterPage: input.splitAfterPage,
            autoApplySuggestions: input.autoApplySuggestions,
          },
        }),
      ]);

      return SplitDocumentResponseSchema.parse({
        remainingDocument: this.toDocumentResponse(remaining),
        extractedDocument: this.toDocumentResponse(extracted),
      });
    } catch (error) {
      if (!documentsCreated) {
        await Promise.allSettled([
          this.storage.remove(remainingStored.storageKey),
          this.storage.remove(extractedStored.storageKey),
        ]);
      } else {
        this.logger.error(
          'Document split failed after output documents were created; files retained for recovery',
          {
            sourceDocumentUuid: original.uuid,
            remainingDocumentUuid: remainingUuid,
            extractedDocumentUuid: extractedUuid,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      this.logger.error('Document split failed', {
        documentUuid: original.uuid,
        splitAfterPage: input.splitAfterPage,
        documentsCreated,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Rotates one page and stores the result as the next version of the document.
   *
   * @param {string} ownerUuid - UUID of the authenticated document owner.
   * @param {string} uuid - UUID of the document to rotate.
   * @param {RotateDocumentInput} input - Page number and clockwise rotation step.
   * @returns The rotated document as a new, queued version.
   */
  async rotatePage(ownerUuid: string, uuid: string, input: RotateDocumentInput) {
    const original = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!original) throw new NotFoundException('Document not found');
    this.assertDocumentContentAvailable(original);

    const adapter = this.formats.getAdapterForMimeType(original.mimeType, 'page-rotation');
    const rotatedBuffer = await adapter.rotatePage(
      original.storageKey,
      input.pageNumber,
      input.rotationDegrees,
    );
    const rotatedUuid = randomUUID();
    const stored = await adapter.storeOriginal(
      rotatedBuffer,
      rotatedUuid,
      original.originalFilename,
      original.mimeType,
    );
    const malwareScanRequired = await this.isMalwareScanRequired();
    const family = await this.documents.findOwnedVersionFamily(
      ownerUuid,
      original.versionFamilyUuid,
    );
    const nextVersion = Math.max(...family.map((version) => version.versionNumber), 0) + 1;
    let documentCreated = false;

    try {
      const rotated = await this.documents.create({
        uuid: rotatedUuid,
        ownerUuid,
        versionFamilyUuid: original.versionFamilyUuid,
        versionNumber: nextVersion,
        versionParentUuid: null,
        title: original.title,
        originalFilename: original.originalFilename,
        mimeType: original.mimeType,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        storageKey: stored.storageKey,
        thumbnailKey: null,
        pageCount: original.pageCount,
        issuerUuid: original.issuerUuid,
        isNew: true,
        status: malwareScanRequired ? 'scanning' : 'processing',
      });
      documentCreated = true;

      const sourceMetadata = await this.metadata.getDocumentMetadata(ownerUuid, original.uuid);
      await this.metadata.setDocumentMetadata(ownerUuid, rotated.uuid, {
        issuerUuid: sourceMetadata.issuer?.uuid ?? null,
        documentTypeUuid: sourceMetadata.documentType?.uuid ?? null,
        categoryUuid: sourceMetadata.category?.uuid ?? null,
        tagUuids: sourceMetadata.tags.map((tag) => tag.uuid),
        custom: sourceMetadata.custom,
      });
      const sourceFolders = await this.folders.listForDocument(ownerUuid, original.uuid);
      await Promise.all(
        sourceFolders.map((folder) => this.folders.createLinks(folder.uuid, [rotated.uuid])),
      );

      await this.documents.update(original.uuid, { versionParentUuid: rotated.uuid });
      await this.addManualUploadToInbox(
        rotated.uuid,
        ownerUuid,
        {
          buffer: rotatedBuffer,
          mimetype: original.mimeType,
          originalname: original.originalFilename,
        },
        stored.checksumSha256,
        stored.sizeBytes,
        false,
        false,
      );
      await this.pipeline.enqueue(
        rotated.uuid,
        ownerUuid,
        malwareScanRequired ? 'malware-scan' : 'text-extraction',
      );
      await this.recordAudit({
        documentUuid: rotated.uuid,
        ownerUuid,
        actorUuid: ownerUuid,
        actorType: 'user',
        eventType: 'document-rotated',
        summary: 'Document page rotated; result became a new document version',
        details: {
          sourceDocumentUuid: original.uuid,
          pageNumber: input.pageNumber,
          rotationDegrees: input.rotationDegrees,
        },
      });

      return RotateDocumentResponseSchema.parse({ document: this.toDocumentResponse(rotated) });
    } catch (error) {
      if (!documentCreated) await this.storage.remove(stored.storageKey).catch(() => undefined);
      this.logger.error('Document page rotation failed', {
        documentUuid: original.uuid,
        rotatedDocumentUuid: rotatedUuid,
        pageNumber: input.pageNumber,
        rotationDegrees: input.rotationDegrees,
        documentCreated,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Inserts selected pages from one or more PDFs into a target and creates a new version.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {ComposeDocumentInput} input - Validated input describing the requested operation.
   * @returns The composed PDF after it has been stored and queued for processing.
   */
  async compose(ownerUuid: string, uuid: string, input: ComposeDocumentInput) {
    const requestedSources = input.sources ?? [
      {
        documentUuid: input.sourceDocumentUuid!,
        startPage: undefined,
        endPage: undefined,
      },
    ];
    if (requestedSources.some((source) => source.documentUuid === uuid)) {
      throw new BadRequestException('A document cannot be inserted into itself');
    }
    if (new Set(requestedSources.map((source) => source.documentUuid)).size !== requestedSources.length) {
      throw new BadRequestException('A source document can only be added once');
    }

    const [target, ...sourceDocuments] = await Promise.all([
      this.documents.findOwnedByUuid(ownerUuid, uuid),
      ...requestedSources.map((source) => this.documents.findOwnedByUuid(ownerUuid, source.documentUuid)),
    ]);
    if (!target || sourceDocuments.some((source) => !source)) {
      throw new NotFoundException('Document not found');
    }
    this.assertDocumentContentAvailable(target);
    sourceDocuments.forEach((source) => this.assertDocumentContentAvailable(source!));

    const adapter = this.formats.getAdapterForMimeType(target.mimeType, 'compose');
    const compositionSources = requestedSources.map((selection, index) => {
      const source = sourceDocuments[index]!;
      this.formats.getAdapterForMimeType(source.mimeType, 'compose');
      const pageCount = source.pageCount ?? 1;
      const startPage = selection.startPage ?? 1;
      const endPage = selection.endPage ?? pageCount;
      if (startPage > endPage || endPage > pageCount) {
        throw new BadRequestException(`The selected pages must be between page 1 and page ${pageCount}`);
      }
      return { document: source, startPage, endPage };
    });
    const composed = await adapter.compose(
      target.storageKey,
      compositionSources.map(({ document, startPage, endPage }) => ({
        storageKey: document.storageKey,
        startPage,
        endPage,
      })),
      input.insertAfterPage,
    );
    const composedUuid = randomUUID();
    const composedName = this.composeFilename(
      target.originalFilename,
      compositionSources.map(({ document }) => document.originalFilename),
    );
    const stored = await adapter.storeOriginal(composed.buffer, composedUuid, composedName);
    const malwareScanRequired = await this.isMalwareScanRequired();
    const family = await this.documents.findOwnedVersionFamily(ownerUuid, target.versionFamilyUuid);
    const nextVersion = Math.max(...family.map((version) => version.versionNumber), 0) + 1;
    // Until the document row exists, any failure can safely remove the stored
    // composite file; after that point, normal document cleanup owns it.
    let documentCreated = false;

    try {
      const created = await this.documents.create({
        uuid: composedUuid,
        ownerUuid,
        versionFamilyUuid: target.versionFamilyUuid,
        versionNumber: nextVersion,
        versionParentUuid: null,
        title: target.title,
        originalFilename: composedName,
        mimeType: adapter.descriptor.mimeTypes[0]!,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        storageKey: stored.storageKey,
        thumbnailKey: null,
        pageCount: composed.pageCount,
        issuerUuid: input.copyMetadata ? target.issuerUuid : null,
        isNew: true,
        status: malwareScanRequired ? 'scanning' : 'processing',
      });
      documentCreated = true;

      if (input.copyMetadata) {
        const sourceMetadata = await this.metadata.getDocumentMetadata(ownerUuid, target.uuid);
        await this.metadata.setDocumentMetadata(ownerUuid, created.uuid, {
          issuerUuid: sourceMetadata.issuer?.uuid ?? null,
          documentTypeUuid: sourceMetadata.documentType?.uuid ?? null,
          categoryUuid: sourceMetadata.category?.uuid ?? null,
          tagUuids: sourceMetadata.tags.map((tag) => tag.uuid),
          custom: sourceMetadata.custom,
        });
        const targetFolders = await this.folders.listForDocument(ownerUuid, target.uuid);
        await Promise.all(
          targetFolders.map((folder) => this.folders.createLinks(folder.uuid, [created.uuid])),
        );
      }

      await this.documents.update(target.uuid, { versionParentUuid: created.uuid });
      await this.addManualUploadToInbox(
        created.uuid,
        ownerUuid,
        {
          buffer: composed.buffer,
          mimetype: adapter.descriptor.mimeTypes[0]!,
          originalname: composedName,
        },
        stored.checksumSha256,
        stored.sizeBytes,
        input.autoApplySuggestions,
        input.autoApplySuggestions,
      );
      await this.pipeline.enqueue(
        created.uuid,
        ownerUuid,
        malwareScanRequired ? 'malware-scan' : 'text-extraction',
      );
      await this.recordAudit({
        documentUuid: created.uuid,
        ownerUuid,
        actorUuid: ownerUuid,
        actorType: 'user',
        eventType: 'document-composed',
        summary: 'Document composed from another document',
        details: {
          targetDocumentUuid: target.uuid,
          sources: compositionSources.map(({ document, startPage, endPage }) => ({
            documentUuid: document.uuid,
            startPage,
            endPage,
          })),
          insertAfterPage: input.insertAfterPage,
          copyMetadata: input.copyMetadata,
          autoApplySuggestions: input.autoApplySuggestions,
        },
      });

      return ComposeDocumentResponseSchema.parse({ document: this.toDocumentResponse(created) });
    } catch (error) {
      if (!documentCreated) await this.storage.remove(stored.storageKey).catch(() => undefined);
      this.logger.error('Document composition failed', {
        targetDocumentUuid: target.uuid,
        sourceDocumentUuids: compositionSources.map(({ document }) => document.uuid),
        composedDocumentUuid: composedUuid,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Adds a split descriptor to a source filename while preserving the PDF extension.
   *
   * @param {string} filename - Source or destination filename for the file operation.
   * @param {string} suffix - Filename suffix to identify the split output.
   * @returns {string} - Adds a split descriptor to a source filename while preserving the PDF extension.
   */
  private splitFilename(filename: string, suffix: string): string {
    const extension = extname(filename) || '.pdf';
    return `${filename.slice(0, -extension.length)} (${suffix})${extension}`.slice(0, 255);
  }

  /**
   * Builds a filename identifying the target and its inserted source documents.
   *
   * @param {string} targetFilename - Original filename of the target document.
   * @param {string[]} sourceFilenames - Original filenames of the inserted source documents.
   * @returns {string} - Filename for the composed document.
   */
  private composeFilename(targetFilename: string, sourceFilenames: string[]): string {
    const extension = extname(targetFilename) || '.pdf';
    const targetBase = targetFilename.slice(0, -extension.length);
    const sourceBases = sourceFilenames.map((filename) => {
      const sourceExtension = extname(filename);
      return sourceExtension ? filename.slice(0, -sourceExtension.length) : filename;
    });
    const suffix = sourceBases.length > 1
      ? `${sourceBases[0]} + ${sourceBases.length - 1} more`
      : sourceBases[0]!;
    return `${targetBase} + ${suffix}${extension}`.slice(0, 255);
  }

  /**
   * Generates or returns an AI title and metadata suggestion for a document.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Generates or returns an AI title and metadata suggestion for a document.
   */
  async suggestTitle(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    this.assertDocumentContentAvailable(document);
    const suggestion = await this.titleSuggestions.suggest(ownerUuid, uuid);
    await this.recordAudit({
      documentUuid: uuid,
      ownerUuid,
      actorUuid: ownerUuid,
      actorType: 'user',
      eventType: 'ai-suggestion-generated',
      summary: 'AI metadata suggestion generated',
      details: { fields: this.suggestionFields(suggestion) },
    });
    return suggestion;
  }

  /**
   * Clears an AI suggestion and optionally records the user's dismissal in the audit log.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {boolean} recordDismissalAudit - Whether to record an audit event for the dismissed suggestion.
   * @returns Clears an AI suggestion and optionally records the user's dismissal in the audit log.
   */
  async clearSuggestion(ownerUuid: string, uuid: string, recordDismissalAudit = true) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    const cleared = document.aiSuggestion !== null;
    if (cleared) {
      await this.documents.update(uuid, { aiSuggestion: null });
      if (recordDismissalAudit) {
        await this.recordAudit({
          documentUuid: uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'ai-suggestion-cleared',
          summary: 'AI metadata suggestion dismissed',
        });
      }
    }
    return ClearDocumentSuggestionResponseSchema.parse({ cleared });
  }

  /**
   * Resolves the authorized original PDF for download or viewing.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Resolves the authorized original PDF for download or viewing.
   */
  async getFile(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);
    this.assertDocumentContentAvailable(document);
    return {
      document: this.toDocumentResponse(document),
      stream: await this.storage.openReadStream(document.storageKey),
    };
  }

  /**
   * Marks a document as opened and returns its updated review state.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<{ isNew: boolean; updatedAt: Date }>} - Marks a document as opened and returns its updated review state.
   */
  async markOpened(ownerUuid: string, uuid: string): Promise<{ isNew: boolean; updatedAt: Date }> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      const sharedDocument = (await this.documents.findAccessibleCandidates([uuid]))[0];
      if (sharedDocument && (await this.sharing.canReadDocument(ownerUuid, uuid))) {
        return { isNew: sharedDocument.isNew, updatedAt: sharedDocument.updatedAt };
      }
      throw new NotFoundException('Document not found');
    }

    if (!document.isNew || !(await this.shouldClearNewMarkerOnOpen())) {
      return { isNew: document.isNew, updatedAt: document.updatedAt };
    }

    const updated = await this.documents.update(uuid, { isNew: false });
    if (!updated) {
      throw new NotFoundException('Document not found');
    }

    this.eventEmitter.emit('inbox.changed', {
      reason: 'document-reviewed',
      documentUuids: [uuid],
    });
    await this.recordAudit({
      documentUuid: uuid,
      ownerUuid,
      actorUuid: ownerUuid,
      actorType: 'user',
      eventType: 'metadata-changed',
      summary: 'Document marked as reviewed after first opening',
      details: { fields: ['reviewState'], reason: 'first-open' },
    });

    return { isNew: updated.isNew, updatedAt: updated.updatedAt };
  }

  /**
   * Queues PDF/A archive conversion for a document when one is not already running.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Queues PDF/A archive conversion for a document when one is not already running.
   */
  async queueArchive(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    this.assertDocumentContentAvailable(document);
    this.formats.getAdapterForMimeType(document.mimeType, 'pdfa');
    if (!(await this.storage.exists(document.storageKey))) {
      throw new BadRequestException('The original document file is not available in storage');
    }

    const queued = await this.documents.update(uuid, {
      archiveKey: null,
      archiveStatus: 'queued',
      archiveError: null,
    });
    if (!queued) throw new NotFoundException('Document not found');

    await this.recordAudit({
      documentUuid: uuid,
      ownerUuid,
      actorUuid: ownerUuid,
      actorType: 'user',
      eventType: 'archive-queued',
      summary: 'PDF/A archive generation requested',
      details: { jobKind: 'pdfa' },
    });

    let job: Awaited<ReturnType<PipelineService['enqueue']>>;
    try {
      job = await this.pipeline.enqueue(uuid, ownerUuid, 'pdfa');
    } catch (error) {
      await this.documents.update(uuid, {
        archiveStatus: 'failed',
        archiveError: error instanceof Error ? error.message.slice(0, 2000) : String(error),
      });
      throw error;
    }

    const updated = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!updated) throw new NotFoundException('Document not found');
    return { document: this.toDocumentResponse(updated), job };
  }

  /**
   * Resolves the generated PDF/A archive when it is ready.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Resolves the generated PDF/A archive when it is ready.
   */
  async getArchive(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);
    this.assertDocumentContentAvailable(document);
    this.formats.getAdapterForMimeType(document.mimeType, 'pdfa');
    if (document.archiveStatus !== 'ready' || !document.archiveKey) {
      throw new NotFoundException('The PDF/A archive is not available');
    }
    if (!(await this.storage.exists(document.archiveKey))) {
      if (document.ownerUuid === ownerUuid) {
        await this.documents.update(uuid, {
          archiveStatus: 'failed',
          archiveError: 'The generated PDF/A archive is missing from storage',
        });
      }
      throw new NotFoundException('The PDF/A archive is missing from storage');
    }

    const baseName = this.sanitizeArchiveSegment(
      document.title || document.originalFilename.replace(/\.pdf$/i, ''),
      uuid,
    );
    return {
      document: this.toDocumentResponse(document),
      filename: `${baseName}.pdf`,
      stream: await this.storage.openReadStream(document.archiveKey),
    };
  }

  /**
   * Returns OCR text and extraction status for the document.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns OCR text and extraction status for the document.
   */
  async getExtractedText(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);
    const pages = await DocumentPage.findAll({
      where: { documentUuid: uuid },
      order: [['segmentIndex', 'ASC']],
    });
    this.assertDocumentContentAvailable(document);
    return DocumentExtractedTextResponseSchema.parse({
      text: pages.map((page) => page.text).join('\n\n'),
      segments: pages.map((page) => ({
        segmentIndex: page.segmentIndex,
        pageNumber: page.pageNumber,
        text: page.text,
      })),
      pages: pages.flatMap((page) =>
        page.pageNumber === null ? [] : [{ pageNumber: page.pageNumber, text: page.text }],
      ),
    });
  }

  /**
   * Returns an existing thumbnail or generates one while limiting concurrent work.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns An existing thumbnail or generates one while limiting concurrent work.
   */
  async getThumbnail(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);

    this.assertDocumentContentAvailable(document);
    this.formats.getAdapterForMimeType(document.mimeType, 'preview');

    const thumbnailKey = await this.ensureThumbnail(document);

    return {
      document: this.toDocumentResponse(document),
      stream: await this.storage.openReadStream(thumbnailKey),
    };
  }

  /**
   * Returns a saved thumbnail or reuses an in-flight generation for this document.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @returns {Promise<string>} - A saved thumbnail or reuses an in-flight generation for this document.
   */
  private async ensureThumbnail(
    document: import('../models/document.entity').Document,
  ): Promise<string> {
    let thumbnailKey = document.thumbnailKey;
    if (thumbnailKey && (await this.storage.exists(thumbnailKey))) return thumbnailKey;

    const activeGeneration = this.thumbnailGeneration.get(document.uuid);
    if (activeGeneration) return activeGeneration;

    const generation = this.generateThumbnail(document).finally(() =>
      this.thumbnailGeneration.delete(document.uuid),
    );
    this.thumbnailGeneration.set(document.uuid, generation);
    return generation;
  }

  /**
   * Converts and stores a thumbnail, updating the document's thumbnail key.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @returns {Promise<string>} - Converts and stores a thumbnail, updating the document's thumbnail key.
   */
  private async generateThumbnail(
    document: import('../models/document.entity').Document,
  ): Promise<string> {
    await this.acquireThumbnailGenerationSlot();
    try {
      // Re-check after joining the in-flight map in case another request finished first.
      if (document.thumbnailKey && (await this.storage.exists(document.thumbnailKey))) {
        return document.thumbnailKey;
      }

      const adapter = this.formats.getAdapterForMimeType(document.mimeType, 'preview');
      const thumbnailKey = await adapter.createPreview(
        document.storageKey,
        document.uuid,
        document.createdAt,
      );
      await this.documents.update(document.uuid, { thumbnailKey });
      document.thumbnailKey = thumbnailKey;
      return thumbnailKey;
    } catch {
      throw new NotFoundException('Document thumbnail could not be generated');
    } finally {
      this.releaseThumbnailGenerationSlot();
    }
  }

  /**
   * Waits until the configured limit allows another thumbnail conversion.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async acquireThumbnailGenerationSlot(): Promise<void> {
    if (this.activeThumbnailGenerations >= DocumentService.MAX_CONCURRENT_THUMBNAIL_GENERATIONS) {
      await new Promise<void>((resolve) => this.thumbnailGenerationWaiters.push(resolve));
      return;
    }
    this.activeThumbnailGenerations += 1;
  }

  /**
   * Releases a conversion slot and wakes the next waiting thumbnail request.
   *
   * @returns {void} - No value.
   */
  private releaseThumbnailGenerationSlot(): void {
    const next = this.thumbnailGenerationWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeThumbnailGenerations -= 1;
  }

  /**
   * Returns pipeline state and recent processing events for the document.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Pipeline state and recent processing events for the document.
   */
  async getPipeline(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return this.pipeline.getForDocument(ownerUuid, uuid);
  }

  /**
   * Requeues eligible failed processing steps for the owned document.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Requeues eligible failed processing steps for the owned document.
   */
  async requeue(ownerUuid: string, uuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (!(await this.storage.exists(document.storageKey))) {
      throw new BadRequestException('The original document file is not available in storage');
    }

    const malwareScanRequired = await this.isMalwareScanRequired();
    const updated = await this.documents.update(document.uuid, {
      status: malwareScanRequired ? 'scanning' : 'processing',
      isNew: true,
      aiSuggestion: null,
    });
    if (!updated) {
      throw new NotFoundException('Document not found');
    }

    const job = await this.pipeline.enqueue(
      updated.uuid,
      ownerUuid,
      malwareScanRequired ? 'malware-scan' : 'text-extraction',
    );
    await this.inboxItems.queueDocumentForAnalysis({
      ownerUuid,
      documentUuid: updated.uuid,
      originalFilename: updated.originalFilename,
      checksumSha256: updated.checksumSha256,
      sizeBytes: Number(updated.sizeBytes),
    });
    this.eventEmitter.emit('inbox.changed', {
      reason: 'document-requeued',
      documentUuids: [updated.uuid],
    });
    await this.recordAudit({
      documentUuid: uuid,
      ownerUuid,
      actorUuid: ownerUuid,
      actorType: 'user',
      eventType: 'requeued',
      summary: 'Document processing requeued',
      details: { jobKind: malwareScanRequired ? 'malware-scan' : 'text-extraction' },
    });
    return {
      document: this.toDocumentResponse(updated),
      job,
    };
  }

  /**
   * Reads the current malware-scanning policy, failing closed if it is unavailable.
   *
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  private async isMalwareScanRequired(): Promise<boolean> {
    try {
      const value = await this.settings.get('security.malwareScan.required', 'true');
      return value?.trim().toLowerCase() !== 'false';
    } catch (error) {
      this.logger.warn('Unable to read malware scanning policy; failing closed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  /**
   * Rejects actions on documents whose PDF is quarantined or not yet scanned.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @returns {void} - No value.
   */
  private assertDocumentContentAvailable(
    document: import('../models/document.entity').Document,
  ): void {
    if (document.status === 'uploaded' || document.status === 'scanning') {
      throw new BadRequestException('The document is waiting for malware scanning');
    }
    if (document.status === 'quarantined') {
      throw new BadRequestException('The document is quarantined and cannot be accessed');
    }
  }

  /**
   * Resolves an owned or shared document and hides inaccessible records as not found.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<Document>} - Resolves an owned or shared document and hides inaccessible records as not found.
   */
  private async findReadableDocument(ownerUuid: string, uuid: string): Promise<Document> {
    const document = (await this.documents.findAccessibleCandidates([uuid]))[0];
    if (
      !document ||
      (document.ownerUuid !== ownerUuid && !(await this.sharing.canReadDocument(ownerUuid, uuid)))
    ) {
      throw new NotFoundException('Document not found');
    }
    return document;
  }

  /**
   * Loads editable metadata and pending suggestions for a document.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @returns Loads editable metadata and pending suggestions for a document.
   */
  async getMetadata(ownerUuid: string, uuid: string) {
    const document = await this.findReadableDocument(ownerUuid, uuid);
    if (document.ownerUuid !== ownerUuid)
      throw new NotFoundException('Document metadata not found');
    return this.metadata.getDocumentMetadata(ownerUuid, uuid);
  }

  /**
   * Saves document metadata, reconciles folder/tag links, and records audit changes.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {SetDocumentMetadataInput} input - Validated input describing the requested operation.
   * @returns Saves document metadata, reconciles folder/tag links, and records audit changes.
   */
  async setMetadata(ownerUuid: string, uuid: string, input: SetDocumentMetadataInput) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const previousMetadata = await this.metadata.getDocumentMetadata(ownerUuid, uuid);
    const metadata = await this.metadata.setDocumentMetadata(ownerUuid, uuid, input);
    if (metadata) {
      await this.classificationFeedback.recordManualChanges(
        ownerUuid,
        uuid,
        previousMetadata,
        metadata,
      );
      const clearNewMarker = await this.shouldClearNewMarkerOnMetadataSave();
      const reviewStateChanged = clearNewMarker && document.isNew;
      if (reviewStateChanged) {
        await this.documents.update(uuid, { isNew: false });
      }
      this.eventEmitter.emit('inbox.changed', {
        reason: 'document-reviewed',
        documentUuids: [uuid],
      });
      const fields = this.metadataFields(input);
      if (reviewStateChanged) fields.push('reviewState');
      if (fields.length > 0) {
        await this.recordAudit({
          documentUuid: uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'metadata-changed',
          summary: 'Document metadata changed',
          details: { fields },
        });
      }
    }
    return metadata;
  }

  /**
   * Checks whether saving metadata should clear the document's new marker.
   *
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  private async shouldClearNewMarkerOnMetadataSave(): Promise<boolean> {
    return (await this.reviewStateClearPolicy()) === 'metadata';
  }

  /**
   * Checks whether opening a document should clear its new marker.
   *
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  private async shouldClearNewMarkerOnOpen(): Promise<boolean> {
    return (await this.reviewStateClearPolicy()) === 'open';
  }

  /**
   * Returns the configured action that clears the new-document review marker.
   *
   * @returns {Promise<'metadata' | 'open'>} - The configured action that clears the new-document review marker.
   */
  private async reviewStateClearPolicy(): Promise<'metadata' | 'open'> {
    try {
      const value = await this.settings.get('documents.reviewState.clearOn', 'metadata');
      return value?.trim() === 'open' ? 'open' : 'metadata';
    } catch (error) {
      this.logger.warn(
        `Unable to read new-document marker policy; defaulting to metadata save: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'metadata';
    }
  }

  /**
   * Copies suggested values only into metadata fields that are currently empty.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {string} uuid - UUID of the target document or record.
   * @param {DocumentTitleSuggestion} suggestion - AI-generated metadata suggestion to apply or inspect.
   * @param {ClassificationFeedbackField[]} onlyFields - Allowlist of metadata fields to apply.
   * @returns {Promise<{ appliedFields: string[] }>} - Copies suggested values only into metadata fields that are currently empty.
   */
  async applySuggestionToEmptyFields(
    ownerUuid: string,
    uuid: string,
    suggestion: DocumentTitleSuggestion,
    onlyFields?: ClassificationFeedbackField[],
  ): Promise<{ appliedFields: string[] }> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, uuid);
    if (!document) throw new NotFoundException('Document not found');
    this.assertDocumentContentAvailable(document);

    const metadata = await this.metadata.getDocumentMetadata(ownerUuid, uuid);
    const appliedFields: string[] = [];
    const canApply = (field: ClassificationFeedbackField | 'title' | 'custom'): boolean =>
      onlyFields === undefined || onlyFields.includes(field as ClassificationFeedbackField);
    const titleIsEmpty =
      !document.title?.trim() || document.title.trim() === document.originalFilename.trim();
    if (canApply('title') && titleIsEmpty && suggestion.suggestedTitle.trim()) {
      await this.documents.update(uuid, { title: suggestion.suggestedTitle });
      appliedFields.push('title');
    }

    const classification: SetDocumentMetadataInput = {};
    if (canApply('issuer') && !metadata.issuer) {
      if (suggestion.issuerUuid) {
        classification.issuerUuid = suggestion.issuerUuid;
      } else if (suggestion.suggestedIssuer) {
        try {
          const issuer = await this.issuers.findOrCreate(ownerUuid, suggestion.suggestedIssuer);
          classification.issuerUuid = issuer.uuid;
        } catch (error) {
          this.logger.warn(
            `Unable to create suggested issuer for ${uuid}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    if (canApply('documentType') && !metadata.documentType && suggestion.documentTypeUuid) {
      classification.documentTypeUuid = suggestion.documentTypeUuid;
    }
    if (canApply('category') && !metadata.category && suggestion.categoryUuid) {
      classification.categoryUuid = suggestion.categoryUuid;
    }
    if (canApply('tag') && metadata.tags.length === 0 && suggestion.tagUuids.length > 0) {
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
        this.logger.warn(
          `Unable to auto-apply document classification for ${uuid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const newCustomValues = Object.fromEntries(
      Object.entries(suggestion.custom).filter(([key, value]) => {
        const current = metadata.custom[key];
        return this.isEmptyMetadataValue(current) && !this.isEmptyMetadataValue(value);
      }),
    );
    if (canApply('custom') && Object.keys(newCustomValues).length > 0) {
      try {
        await this.metadata.setDocumentMetadata(ownerUuid, uuid, {
          custom: { ...metadata.custom, ...newCustomValues },
        });
        appliedFields.push(...Object.keys(newCustomValues).map((key) => `custom.${key}`));
      } catch (error) {
        this.logger.warn(
          `Unable to auto-apply custom metadata for ${uuid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (appliedFields.length > 0) {
      await this.recordAudit({
        documentUuid: uuid,
        ownerUuid,
        actorUuid: null,
        actorType: 'system',
        eventType: 'ai-suggestion-applied',
        summary: 'AI metadata suggestion applied',
        details: { fields: appliedFields },
      });
    }

    return { appliedFields };
  }

  /**
   * Records which documents the user exported and by which export operation.
   *
   * @param {string} ownerUuid - UUID of the user who owns the resource.
   * @param {Array<import('../models/document.entity').Document>} documents - Document store or service used by this operation.
   * @param {string} summary - Human-readable description of the event.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async recordExportAudit(
    ownerUuid: string,
    documents: Array<import('../models/document.entity').Document>,
    summary: string,
  ): Promise<void> {
    await Promise.all(
      documents.map((document) =>
        this.recordAudit({
          documentUuid: document.uuid,
          ownerUuid,
          actorUuid: ownerUuid,
          actorType: 'user',
          eventType: 'exported',
          summary,
        }),
      ),
    );
  }

  /**
   * Lists metadata fields present in the submitted update for audit reporting.
   *
   * @param {SetDocumentMetadataInput} input - Validated input describing the requested operation.
   * @returns {string[]} - Lists metadata fields present in the submitted update for audit reporting.
   */
  private metadataFields(input: SetDocumentMetadataInput): string[] {
    const fields: string[] = [];
    if (input.documentTypeUuid !== undefined) fields.push('documentType');
    if (input.categoryUuid !== undefined) fields.push('category');
    if (input.issuerUuid !== undefined) fields.push('issuer');
    if (input.tagUuids !== undefined) fields.push('tags');
    if (input.custom !== undefined) {
      const customFields = Object.keys(input.custom)
        .slice(0, 50)
        .map((key) => `custom.${key}`);
      fields.push(...(customFields.length > 0 ? customFields : ['custom']));
    }
    return [...new Set(fields)];
  }

  /**
   * Lists fields populated by an AI metadata suggestion.
   *
   * @param {DocumentTitleSuggestion} suggestion - AI-generated metadata suggestion to apply or inspect.
   * @returns {string[]} - Lists fields populated by an AI metadata suggestion.
   */
  private suggestionFields(suggestion: DocumentTitleSuggestion): string[] {
    const fields = ['title'];
    if (suggestion.documentTypeUuid) fields.push('documentType');
    if (suggestion.categoryUuid) fields.push('category');
    if (suggestion.issuerUuid || suggestion.suggestedIssuer) fields.push('issuer');
    if (suggestion.tagUuids.length > 0) fields.push('tags');
    if (Object.keys(suggestion.custom).length > 0) fields.push('custom');
    return fields;
  }

  /**
   * Persists a document audit event through the audit service.
   *
   * @param {Parameters<DocumentAuditService['record']>[0]} input - Validated input describing the requested operation.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async recordAudit(input: Parameters<DocumentAuditService['record']>[0]): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (error) {
      this.logger.error(
        `Unable to record document audit event '${input.eventType}' for ${input.documentUuid}`,
        error,
      );
    }
  }

  /**
   * Converts a document model and optional derived data into the public API shape.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @param {DocumentMetadataSummary} metadataSummary - Optional metadata summary included in the document response.
   * @param {string | null} calendarEventUrl - Calendar URL associated with the document.
   * @returns {DocumentResponse} - Converts a document model and optional derived data into the public API shape.
   */
  private toDocumentResponse(
    document: import('../models/document.entity').Document,
    metadataSummary?: DocumentMetadataSummary,
    calendarEventUrl: string | null = null,
  ): DocumentResponse {
    return {
      uuid: document.uuid,
      ownerUuid: document.ownerUuid,
      versionFamilyUuid: document.versionFamilyUuid,
      versionNumber: document.versionNumber,
      versionParentUuid: document.versionParentUuid,
      originalFilename: document.originalFilename,
      title: document.title,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
      storageKey: document.storageKey,
      thumbnailKey: document.thumbnailKey,
      thumbnailUrl: this.thumbnailUrl(document.uuid),
      archiveKey: document.archiveKey,
      archiveUrl:
        document.archiveStatus === 'ready' && document.archiveKey
          ? this.archiveUrl(document.uuid)
          : null,
      archiveStatus: document.archiveStatus,
      archiveError: document.archiveError,
      calendarEventUrl,
      pageCount: document.pageCount,
      issuerUuid: document.issuerUuid,
      isNew: document.isNew,
      metadataSummary: metadataSummary ?? {
        documentType: null,
        category: null,
        issuer: null,
        tags: [],
        custom: [],
      },
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * Converts a document into the restricted shape exposed to share recipients.
   *
   * @param {import('../models/document.entity').Document} document - Document being read or updated.
   * @returns {DocumentResponse} - Converts a document into the restricted shape exposed to share recipients.
   */
  private toSharedDocumentResponse(
    document: import('../models/document.entity').Document,
  ): DocumentResponse {
    return {
      ...this.toDocumentResponse(document),
      storageKey: `shared/${document.uuid}`,
      thumbnailKey: null,
      archiveKey: null,
      archiveUrl: null,
      archiveStatus: 'not-requested',
      archiveError: null,
      issuerUuid: null,
      calendarEventUrl: null,
    };
  }

  /**
   * Builds the API route for a document thumbnail.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {string} - Builds the API route for a document thumbnail.
   */
  private thumbnailUrl(uuid: string): string {
    const apiPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    return `/${apiPrefix}/documents/${uuid}/thumbnail`;
  }

  /**
   * Builds the API route for a generated PDF/A archive.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {string} - Builds the API route for a generated PDF/A archive.
   */
  private archiveUrl(uuid: string): string {
    const apiPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    return `/${apiPrefix}/documents/${uuid}/archive`;
  }

  /**
   * Builds the API route for a document's calendar event.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {string} - Builds the API route for a document's calendar event.
   */
  private calendarUrl(uuid: string): string {
    const apiPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    return `/${apiPrefix}/calendar/documents/${uuid}/ics`;
  }

  /**
   * Extracts a short excerpt around the first matching query term.
   *
   * @param {string} text - Extracted or user-entered text to process.
   * @param {string} query - Validated search or document-list criteria.
   * @returns {string} - Extracts a short excerpt around the first matching query term.
   */
  private createSnippet(text: string, query: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 320) return normalized;
    const token =
      query
        .toLocaleLowerCase()
        .split(/\s+/)
        .find((item) => item.length > 2) ?? query.toLocaleLowerCase();
    const index = normalized.toLocaleLowerCase().indexOf(token);
    const start = index > 0 ? Math.max(0, index - 100) : 0;
    const end = Math.min(normalized.length, start + 320);
    return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
  }

  /**
   * Determines whether a metadata value can be filled by an AI suggestion.
   *
   * @param {unknown} value - Value to store, parse, or compare.
   * @returns {boolean} - true when the operation succeeds; otherwise, false.
   */
  private isEmptyMetadataValue(value: unknown): boolean {
    return (
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }
}
