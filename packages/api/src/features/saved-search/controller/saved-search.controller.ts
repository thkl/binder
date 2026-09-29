import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateSavedSearchInputSchema,
  UpdateSavedSearchInputSchema
} from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { SavedSearchService } from '../service/saved-search.service';

@Controller('saved-searches')
@UseGuards(AuthenticationGuard)
export class SavedSearchController {
  constructor(private readonly savedSearches: SavedSearchService) {}

  @Get()
  async list(@CurrentUser() user: ScopedUser) {
    return { data: await this.savedSearches.list(user.userId) };
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.savedSearches.create(user.userId, CreateSavedSearchInputSchema.parse(body))
    };
  }

  @Patch(':uuid')
  async update(@Param('uuid') uuid: string, @Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.savedSearches.update(user.userId, uuid, UpdateSavedSearchInputSchema.parse(body))
    };
  }

  @Delete(':uuid')
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.savedSearches.remove(user.userId, uuid) };
  }
}
