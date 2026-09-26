import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateMetadataDefinitionSchema, CreateVocabularyItemSchema } from '@binder/common';
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

  @Get('definitions')
  async definitions(@CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.listDefinitions(user.userId) };
  }

  @Post('definitions')
  async createDefinition(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return { data: await this.metadata.createDefinition(user.userId, CreateMetadataDefinitionSchema.parse(body), user.isAdmin) };
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
