import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import {
  DocumentBulkActionInputSchema,
  DocumentExportSelectionInputSchema,
  DocumentListQuerySchema,
  DocumentSearchQuerySchema,
  DocumentAnalysisFollowUpSchema,
  DocumentAnalysisPromptSchema,
  SetDocumentMetadataInputSchema,
  SetDocumentTitleInputSchema,
} from '@binder/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { DocumentAnalysisService } from '../service/document-analysis.service';
import { DocumentService, UploadedDocumentFile } from '../service/document.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { Throttle } from '@nestjs/throttler';

const HARD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

@Controller('documents')
@UseGuards(AuthenticationGuard)
export class DocumentController {
  private readonly logger = new BinderLogger(DocumentController.name);

  constructor(
    private readonly documents: DocumentService,
    private readonly analysis: DocumentAnalysisService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
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
    return { data: await this.documents.upload(user.userId, file) };
  }

  @Get()
  async list(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    this.logger.debug(`List files ${JSON.stringify(query)}`);
    const input = DocumentListQuerySchema.parse(query);
    return { data: await this.documents.list(user.userId, input) };
  }

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

  @Get('facets')
  async facets(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    const input = DocumentListQuerySchema.parse(query);
    return { data: await this.documents.facets(user.userId, input) };
  }

  @Get('storage-issues')
  async storageIssues(@CurrentUser() user: ScopedUser) {
    return { data: await this.documents.listStorageIssues(user.userId) };
  }

  @Get('search')
  async search(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.documents.search(user.userId, DocumentSearchQuerySchema.parse(query)),
    };
  }

  @Post('bulk')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bulkAction(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.documents.bulkAction(user.userId, DocumentBulkActionInputSchema.parse(body)),
    };
  }

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
      `inline; filename="${this.safeFilename(result.document.originalFilename)}"`,
    );
    return new StreamableFile(result.stream, { type: result.document.mimeType });
  }

  @Get(':uuid/extracted-text')
  async extractedText(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getExtractedText(user.userId, uuid) };
  }

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

  @Post(':uuid/analysis')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async startAnalysis(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = DocumentAnalysisPromptSchema.parse(body);
    return { data: await this.analysis.start(user.userId, uuid, input.prompt) };
  }

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

  @Post(':uuid/title/suggest')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async suggestTitle(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.suggestTitle(user.userId, uuid) };
  }

  @Delete(':uuid/ai-suggestion')
  async clearSuggestion(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.clearSuggestion(user.userId, uuid) };
  }

  @Get(':uuid/pipeline')
  async pipeline(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getPipeline(user.userId, uuid) };
  }

  @Get(':uuid/metadata')
  async metadata(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getMetadata(user.userId, uuid) };
  }

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

  @Post(':uuid/pipeline/requeue')
  async requeue(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    this.logger.info(`Requeue pipeline for document ${uuid}`);
    return { data: await this.documents.requeue(user.userId, uuid) };
  }

  @Get(':uuid/thumbnail')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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

  @Get(':uuid')
  async get(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    this.logger.debug(`Get document ${uuid}`);
    return { data: await this.documents.get(user.userId, uuid) };
  }

  private safeFilename(filename: string): string {
    return filename.replace(/[\\"\r\n]/g, '_');
  }

  private setArchiveHeaders(response: Response, filename: string): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.safeFilename(filename)}"`,
    );
  }
}
