import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateFolderInputSchema,
  FolderDocumentInputSchema,
  MoveFolderInputSchema,
  UpdateFolderInputSchema
} from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { FolderService } from '../service/folder.service';

@Controller('folders')
@UseGuards(AuthenticationGuard)
export class FolderController {
  constructor(private readonly folders: FolderService) {}

  @Get()
  async list(@CurrentUser() user: ScopedUser, @Query('parentUuid') parentUuid?: string) {
    return { data: await this.folders.list(user.userId, parentUuid || null) };
  }

  @Get('all')
  async listAll(@CurrentUser() user: ScopedUser) {
    return { data: await this.folders.listAll(user.userId) };
  }

  @Get('for-document/:documentUuid')
  async listForDocument(@CurrentUser() user: ScopedUser, @Param('documentUuid') documentUuid: string) {
    return { data: await this.folders.listForDocument(user.userId, documentUuid) };
  }

  @Post()
  async create(@CurrentUser() user: ScopedUser, @Body() body: unknown) {
    return { data: await this.folders.create(user.userId, CreateFolderInputSchema.parse(body)) };
  }

  @Patch(':uuid')
  async update(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string, @Body() body: unknown) {
    return { data: await this.folders.update(user.userId, uuid, UpdateFolderInputSchema.parse(body)) };
  }

  @Post(':uuid/move')
  async move(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string, @Body() body: unknown) {
    return { data: await this.folders.move(user.userId, uuid, MoveFolderInputSchema.parse(body)) };
  }

  @Delete(':uuid')
  async remove(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string) {
    return { data: await this.folders.remove(user.userId, uuid) };
  }

  @Post(':uuid/documents')
  async linkDocuments(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string, @Body() body: unknown) {
    return { data: await this.folders.linkDocuments(user.userId, uuid, FolderDocumentInputSchema.parse(body)) };
  }

  @Delete(':uuid/documents')
  async unlinkDocuments(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string, @Body() body: unknown) {
    return { data: await this.folders.unlinkDocuments(user.userId, uuid, FolderDocumentInputSchema.parse(body)) };
  }
}
