import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateVocabularyItemSchema, SetDocumentMetadataInputSchema } from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { MetadataService } from '../service/metadata.service';

@Controller('metadata')
@UseGuards(AuthenticationGuard)
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Get('vocabulary')
  async vocabulary(@CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.list(user.userId) };
  }

  @Post('vocabulary/document-types')
  async createDocumentType(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.create('documentTypes', user.userId, CreateVocabularyItemSchema.parse(body), user.isAdmin) };
  }

  @Post('vocabulary/categories')
  async createCategory(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.create('categories', user.userId, CreateVocabularyItemSchema.parse(body), user.isAdmin) };
  }

  @Post('vocabulary/tags')
  async createTag(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.create('tags', user.userId, CreateVocabularyItemSchema.parse(body), user.isAdmin) };
  }
}
