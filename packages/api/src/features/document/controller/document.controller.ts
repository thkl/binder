import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  OnModuleDestroy,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DocumentBulkActionInputSchema,
  DocumentExportSelectionInputSchema,
  DocumentListQuerySchema,
  DocumentSearchQuerySchema,
  DocumentAnalysisFollowUpSchema,
  DocumentAnalysisPromptSchema,
  AssignDocumentVersionInputSchema,
  ComposeDocumentInputSchema,
  DocumentAuditQuerySchema,
  BulkMetadataInputSchema,
  SetDocumentMetadataInputSchema,
  SetDocumentTitleInputSchema,
  SplitDocumentInputSchema,
  RotateDocumentInputSchema,
} from '@binder/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { DocumentAnalysisService } from '../service/document-analysis.service';
import { DocumentService, UploadedDocumentFile } from '../service/document.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { Throttle } from '@nestjs/throttler';
import { DocumentAuditService } from '../service/document-audit.service';
import { DocumentBulkMetadataService } from '../service/document-bulk-metadata.service';
import { createContentDisposition } from '../../../shared/http/content-disposition';

const HARD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
// mkdtemp creates a private (0700) directory so buffered PDF contents are never
// exposed through a shared, world-readable temporary directory.
const UPLOAD_TEMP_DIRECTORY = mkdtempSync(join(tmpdir(), 'binder-api-upload-'));

/** Exposes authenticated document listing, storage, metadata, and processing routes. */
@Controller('documents')
@UseGuards(AuthenticationGuard)
export class DocumentController implements OnModuleDestroy {
  private readonly logger = new BinderLogger(DocumentController.name);

  /**
   * Injects document workflows, analysis, auditing, and bulk metadata operations.
   *
   * @param {DocumentService} documents - Document store or service used by this operation.
   * @param {DocumentAnalysisService} analysis - Document analysis service used to process prompts.
   * @param {DocumentAuditService} audit - Audit service used to record document activity.
   * @param {DocumentBulkMetadataService} bulkMetadata - Bulk metadata service used to apply or preview changes.
   */
  constructor(
    private readonly documents: DocumentService,
    private readonly analysis: DocumentAnalysisService,
    private readonly audit: DocumentAuditService,
    private readonly bulkMetadata: DocumentBulkMetadataService,
  ) {}

  /**
   * Removes the private temporary upload directory when the API shuts down.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async onModuleDestroy(): Promise<void> {
    await rm(UPLOAD_TEMP_DIRECTORY, { recursive: true, force: true });
  }

  /**
   * Validates and queues a new PDF upload, then removes its temporary file.
   *
   * @param {UploadedDocumentFile | undefined} file - PDF or other file supplied for this operation.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Validates and queues a new PDF upload, then removes its temporary file.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      dest: UPLOAD_TEMP_DIRECTORY,
      limits: {
        fileSize: HARD_UPLOAD_LIMIT_BYTES,
        files: 1,
        fields: 4,
        parts: 5,
      },
    }),
  )
  async upload(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @CurrentUser() user: ScopedUser,
  ) {
    this.logger.debug('Uploading File ....');
    if (!file) {
      this.logger.error('No file sumbitted');
      throw new BadRequestException('A PDF file is required');
    }
    try {
      return { data: await this.documents.upload(user.userId, file) };
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Returns the authenticated user's document page using validated list filters.
   *
   * @param {Record<string, unknown>} query - Validated search or document-list criteria.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns The authenticated user's document page using validated list filters.
   */
  @Get()
  async list(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    this.logger.debug(`List files ${JSON.stringify(query)}`);
    const input = DocumentListQuerySchema.parse(query);
    return { data: await this.documents.list(user.userId, input) };
  }

  /**
   * Streams a ZIP archive containing documents that match the supplied list filters.
   *
   * @param {Record<string, unknown>} query - Validated search or document-list criteria.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @param {Response} response - HTTP response to populate with headers or content.
   * @returns Streams a ZIP archive containing documents that match the supplied list filters.
   */
  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportFiltered(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.documents.exportFiltered(
      user.userId,
      DocumentListQuerySchema.parse(query),
    );
    this.setArchiveHeaders(response, result.filename);
    return new StreamableFile(result.stream, { type: 'application/zip' });
  }

  /**
   * Streams a ZIP archive containing the explicitly selected owned documents.
   *
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @param {Response} response - HTTP response to populate with headers or content.
   * @returns Streams a ZIP archive containing the explicitly selected owned documents.
   */
  @Post('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportSelected(
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = DocumentExportSelectionInputSchema.parse(body);
    const result = await this.documents.exportSelected(user.userId, input.documentUuids);
    this.setArchiveHeaders(response, result.filename);
    return new StreamableFile(result.stream, { type: 'application/zip' });
  }

  /**
   * Returns filter options and counts for the authenticated user's document list.
   *
   * @param {Record<string, unknown>} query - Validated search or document-list criteria.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Filter options and counts for the authenticated user's document list.
   */
  @Get('facets')
  async facets(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    const input = DocumentListQuerySchema.parse(query);
    return { data: await this.documents.facets(user.userId, input) };
  }

  /**
   * Lists storage-integrity issues visible to the authenticated user.
   *
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists storage-integrity issues visible to the authenticated user.
   */
  @Get('storage-issues')
  async storageIssues(@CurrentUser() user: ScopedUser) {
    return { data: await this.documents.listStorageIssues(user.userId) };
  }

  /**
   * Searches the authenticated user's documents using validated search terms and filters.
   *
   * @param {Record<string, unknown>} query - Validated search or document-list criteria.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Searches the authenticated user's documents using validated search terms and filters.
   */
  @Get('search')
  async search(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.documents.search(user.userId, DocumentSearchQuerySchema.parse(query)),
    };
  }

  /**
   * Lists documents shared directly with the authenticated user or through shared folders.
   *
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists documents shared directly with the authenticated user or through shared folders.
   */
  @Get('shared')
  async listShared(@CurrentUser() user: ScopedUser) {
    return { data: await this.documents.listShared(user.userId) };
  }

  /**
   * Lists shared documents that have no shared-folder placement.
   *
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists shared documents that have no shared-folder placement.
   */
  @Get('shared/unfiled')
  async listSharedUnfiled(@CurrentUser() user: ScopedUser) {
    return { data: await this.documents.listSharedUnfiled(user.userId) };
  }

  /**
   * Runs a validated bulk operation on the authenticated user's selected documents.
   *
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Runs a validated bulk operation on the authenticated user's selected documents.
   */
  @Post('bulk')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bulkAction(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.documents.bulkAction(user.userId, DocumentBulkActionInputSchema.parse(body)),
    };
  }

  /**
   * Previews the effect of a bulk metadata change without applying it.
   *
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Previews the effect of a bulk metadata change without applying it.
   */
  @Post('bulk-metadata/preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async previewBulkMetadata(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.bulkMetadata.preview(user.userId, BulkMetadataInputSchema.parse(body)),
    };
  }

  /**
   * Applies a validated bulk metadata change and records it for possible rollback.
   *
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Applies a validated bulk metadata change and records it for possible rollback.
   */
  @Post('bulk-metadata')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async applyBulkMetadata(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.bulkMetadata.apply(
        user.userId,
        user.userId,
        BulkMetadataInputSchema.parse(body),
      ),
    };
  }

  /**
   * Rolls back a prior bulk metadata change set owned by the authenticated user.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Rolls back a prior bulk metadata change set owned by the authenticated user.
   */
  @Post('change-sets/:uuid/rollback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async rollbackChangeSet(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.bulkMetadata.rollback(user.userId, user.userId, uuid) };
  }

  /**
   * Lists the version family containing the requested document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists the version family containing the requested document.
   */
  @Get(':uuid/versions')
  async versions(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.listVersions(user.userId, uuid) };
  }

  /**
   * Deletes an older document version while preserving the current version.
   *
   * @param {string} uuid - UUID of the historical version to delete.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Resolves with the deleted document identifier.
   */
  @Delete(':uuid/version')
  async removeVersion(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.removeVersion(user.userId, uuid) };
  }

  /**
   * Adds an owned document to the requested document's version family.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Adds an owned document to the requested document's version family.
   */
  @Post(':uuid/version')
  async assignVersion(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = AssignDocumentVersionInputSchema.parse(body);
    return {
      data: await this.documents.assignAsVersion(
        user.userId,
        uuid,
        input.targetDocumentUuid,
        input.copyMetadata,
      ),
    };
  }

  /**
   * Splits an owned PDF into two new documents at the requested page boundary.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Splits an owned PDF into two new documents at the requested page boundary.
   */
  @Post(':uuid/split')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async split(@Param('uuid') uuid: string, @Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.documents.split(user.userId, uuid, SplitDocumentInputSchema.parse(body)),
    };
  }

  /**
   * Rotates one PDF page by a quarter-turn and creates a new document version.
   *
   * @param {string} uuid - UUID of the document to rotate.
   * @param {unknown} body - Untrusted page number and rotation direction.
   * @param {ScopedUser} user - Authenticated document owner.
   * @returns The rotated document version and its processing status.
   */
  @Post(':uuid/rotate')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async rotatePage(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.documents.rotatePage(
        user.userId,
        uuid,
        RotateDocumentInputSchema.parse(body),
      ),
    };
  }

  /**
   * Inserts one document's pages into another and creates a composed document version.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Inserts one document's pages into another and creates a composed document version.
   */
  @Post(':uuid/compose')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async compose(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.documents.compose(user.userId, uuid, ComposeDocumentInputSchema.parse(body)),
    };
  }

  /**
   * Streams the PDF inline after checking that the user can read its contents.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @param {Response} response - HTTP response to populate with headers or content.
   * @returns Streams the PDF inline after checking that the user can read its contents.
   */
  @Get(':uuid/file')
  async file(
    @Param('uuid') uuid: string,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.debug(`Get File ${uuid}`);
    const result = await this.documents.getFile(user.userId, uuid);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      createContentDisposition('inline', result.document.originalFilename),
    );
    return new StreamableFile(result.stream, { type: result.document.mimeType });
  }

  /**
   * Marks a document as opened so the new-document indicator can be cleared.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Marks a document as opened so the new-document indicator can be cleared.
   */
  @Post(':uuid/open')
  async markOpened(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.markOpened(user.userId, uuid) };
  }

  /**
   * Deletes an owned document and its associated records and files.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Deletes an owned document and its associated records and files.
   */
  @Delete(':uuid')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.remove(user.userId, uuid) };
  }

  /**
   * Returns a paginated audit history for a readable document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {Record<string, unknown>} query - Validated search or document-list criteria.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns A paginated audit history for a readable document.
   */
  @Get(':uuid/audit')
  async auditHistory(
    @Param('uuid') uuid: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = DocumentAuditQuerySchema.parse(query);
    return { data: await this.audit.list(user.userId, uuid, input.page, input.pageSize) };
  }

  /**
   * Returns normalized searchable text for each page of a readable document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Normalized searchable text for each page of a readable document.
   */
  @Get(':uuid/extracted-text')
  async extractedText(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getExtractedText(user.userId, uuid) };
  }

  /**
   * Updates the title of an owned document using the shared input contract.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Updates the title of an owned document using the shared input contract.
   */
  @Post(':uuid/title')
  async updateTitle(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.documents.updateTitle(
        user.userId,
        uuid,
        SetDocumentTitleInputSchema.parse(body),
      ),
    };
  }

  /**
   * Starts a document-analysis session with the requested prompt.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Starts a document-analysis session with the requested prompt.
   */
  @Post(':uuid/analysis')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async startAnalysis(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = DocumentAnalysisPromptSchema.parse(body);
    return {
      data: await this.analysis.start(user.userId, uuid, input.prompt, input.forceNew),
    };
  }

  /**
   * Returns the active analysis session for a document, if one exists.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns The active analysis session for a document, if one exists.
   */
  @Get(':uuid/analysis')
  async activeAnalysis(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.analysis.getActiveSession(user.userId, uuid) };
  }

  /**
   * Adds a follow-up prompt to an existing analysis session.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Adds a follow-up prompt to an existing analysis session.
   */
  @Post(':uuid/analysis/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async continueAnalysis(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = DocumentAnalysisFollowUpSchema.parse(body);
    return {
      data: await this.analysis.continue(user.userId, uuid, input.sessionUuid, input.prompt),
    };
  }

  /**
   * Requests an AI-generated title suggestion for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Requests an AI-generated title suggestion for an owned document.
   */
  @Post(':uuid/title/suggest')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async suggestTitle(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.suggestTitle(user.userId, uuid) };
  }

  /**
   * Clears the pending AI suggestion for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Clears the pending AI suggestion for an owned document.
   */
  @Delete(':uuid/ai-suggestion')
  async clearSuggestion(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.clearSuggestion(user.userId, uuid) };
  }

  /**
   * Returns the processing queue and latest job state for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns The processing queue and latest job state for an owned document.
   */
  @Get(':uuid/pipeline')
  async pipeline(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getPipeline(user.userId, uuid) };
  }

  /**
   * Returns editable metadata values for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Editable metadata values for an owned document.
   */
  @Get(':uuid/metadata')
  async metadata(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getMetadata(user.userId, uuid) };
  }

  /**
   * Replaces the editable metadata values for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Replaces the editable metadata values for an owned document.
   */
  @Post(':uuid/metadata')
  async setMetadata(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.documents.setMetadata(
        user.userId,
        uuid,
        SetDocumentMetadataInputSchema.parse(body),
      ),
    };
  }

  /**
   * Queues an owned document for processing again.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Queues an owned document for processing again.
   */
  @Post(':uuid/pipeline/requeue')
  async requeue(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    this.logger.info(`Requeue pipeline for document ${uuid}`);
    return { data: await this.documents.requeue(user.userId, uuid) };
  }

  /**
   * Queues PDF/A archive generation for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Queues PDF/A archive generation for an owned document.
   */
  @Post(':uuid/archive')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async queueArchive(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.queueArchive(user.userId, uuid) };
  }

  /**
   * Streams the generated PDF/A archive for an owned document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @param {Response} response - HTTP response to populate with headers or content.
   * @returns Streams the generated PDF/A archive for an owned document.
   */
  @Get(':uuid/archive')
  async archive(
    @Param('uuid') uuid: string,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.documents.getArchive(user.userId, uuid);
    response.setHeader('Content-Type', 'application/pdf');
    this.setArchiveHeaders(response, result.filename);
    return new StreamableFile(result.stream, { type: 'application/pdf' });
  }

  /**
   * Streams the cached thumbnail, generating it on demand when it is not stored yet.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @param {Response} response - HTTP response to populate with headers or content.
   * @returns Streams the cached thumbnail, generating it on demand when it is not stored yet.
   */
  @Get(':uuid/thumbnail')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  async thumbnail(
    @Param('uuid') uuid: string,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.debug(`Get thumbnail ${uuid}`);
    const result = await this.documents.getThumbnail(user.userId, uuid);
    response.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return new StreamableFile(result.stream, { type: 'image/png' });
  }

  /**
   * Returns document details when the user owns the document or has read access through sharing.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Document details when the user owns the document or has read access through sharing.
   */
  @Get(':uuid')
  async get(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    this.logger.debug(`Get document ${uuid}`);
    return { data: await this.documents.get(user.userId, uuid) };
  }

  /**
   * Sets private download headers and a safe attachment filename for archive responses.
   *
   * @param {Response} response - HTTP response to populate with headers or content.
   * @param {string} filename - Source or destination filename for the file operation.
   * @returns {void} - No value.
   */
  private setArchiveHeaders(response: Response, filename: string): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', createContentDisposition('attachment', filename));
  }
}
