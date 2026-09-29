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
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  DocumentBulkActionInputSchema,
  DocumentExportSelectionInputSchema,
  DocumentListQuerySchema,
  DocumentSearchQuerySchema,
  SetDocumentMetadataInputSchema,
  SetDocumentTitleInputSchema
} from '@binder/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { DocumentService, UploadedDocumentFile } from '../service/document.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('documents')
@UseGuards(AuthenticationGuard)
export class DocumentController {
  private readonly logger = new BinderLogger(DocumentController.name);

  constructor(private readonly documents: DocumentService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @CurrentUser() user: ScopedUser
  ) {
    this.logger.debug("Uploading File ....");
    if (!file) {
      this.logger.error("No file sumbitted");
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
  async exportFiltered(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.documents.exportFiltered(user.userId, DocumentListQuerySchema.parse(query));
    this.setArchiveHeaders(response, result.filename);
    return new StreamableFile(result.stream, { type: 'application/zip' });
  }

  @Post('export')
  async exportSelected(
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response
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

  @Get('search')
  async search(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.search(user.userId, DocumentSearchQuerySchema.parse(query)) };
  }

  @Post('bulk')
  async bulkAction(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.bulkAction(user.userId, DocumentBulkActionInputSchema.parse(body)) };
  }

  @Get(':uuid/file')
  async file(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser, @Res({ passthrough: true }) response: Response) {
    this.logger.debug(`Get File ${uuid}`);
    const result = await this.documents.getFile(user.userId, uuid);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `inline; filename="${this.safeFilename(result.document.originalFilename)}"`);
    return new StreamableFile(result.stream, { type: result.document.mimeType });
  }

  @Get(':uuid/extracted-text')
  async extractedText(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.getExtractedText(user.userId, uuid) };
  }

  @Post(':uuid/title')
  async updateTitle(@Param('uuid') uuid: string, @Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.updateTitle(user.userId, uuid, SetDocumentTitleInputSchema.parse(body)) };
  }

  @Post(':uuid/title/suggest')
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
  async setMetadata(@Param('uuid') uuid: string, @Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.setMetadata(user.userId, uuid, SetDocumentMetadataInputSchema.parse(body)) };
  }

  @Post(':uuid/pipeline/requeue')
  async requeue(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    this.logger.info(`Requeue pipeline for document ${uuid}`);
    return { data: await this.documents.requeue(user.userId, uuid) };
  }

  @Get(':uuid/thumbnail')
  @SkipThrottle()
  async thumbnail(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser, @Res({ passthrough: true }) response: Response) {
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
    response.setHeader('Content-Disposition', `attachment; filename="${this.safeFilename(filename)}"`);
  }
}
