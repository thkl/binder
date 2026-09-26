import {
  BadRequestException,
  Body,
  Controller,
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
import { DocumentListQuerySchema } from '@binder/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { DocumentService, UploadedDocumentFile } from '../service/document.service';

@Controller('documents')
@UseGuards(AuthenticationGuard)
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @CurrentUser() user: ScopedUser
  ) {
    if (!file) {
      throw new BadRequestException('A PDF file is required');
    }
    return { data: await this.documents.upload(user.userId, file) };
  }

  @Get()
  async list(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    const input = DocumentListQuerySchema.parse(query);
    return { data: await this.documents.list(user.userId, input) };
  }

  @Get(':uuid/file')
  async file(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser, @Res({ passthrough: true }) response: Response) {
    const result = await this.documents.getFile(user.userId, uuid);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `inline; filename="${this.safeFilename(result.document.originalFilename)}"`);
    return new StreamableFile(result.stream, { type: result.document.mimeType });
  }

  @Get(':uuid')
  async get(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.documents.get(user.userId, uuid) };
  }

  private safeFilename(filename: string): string {
    return filename.replace(/[\\"\r\n]/g, '_');
  }
}
