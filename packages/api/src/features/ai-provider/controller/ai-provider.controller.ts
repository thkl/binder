import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  AiProviderTestInputSchema,
  CreateAiProviderProfileInputSchema,
  SetAiProviderSelectionInputSchema,
  UpdateAiProviderProfileInputSchema,
} from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { AiProviderService } from '../service/ai-provider.service';

@Controller('ai/providers')
@UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
@Roles('admin')
@Scopes(['web'])
export class AiProviderController {
  constructor(private readonly aiProviders: AiProviderService) {}

  @Get()
  async list() {
    return { data: await this.aiProviders.getConfiguration() };
  }

  @Post()
  async create(@Body() body: unknown) {
    return { data: await this.aiProviders.create(CreateAiProviderProfileInputSchema.parse(body)) };
  }

  @Patch(':uuid')
  async update(@Param('uuid') uuid: string, @Body() body: unknown) {
    return {
      data: await this.aiProviders.update(uuid, UpdateAiProviderProfileInputSchema.parse(body)),
    };
  }

  @Delete(':uuid')
  async remove(@Param('uuid') uuid: string) {
    await this.aiProviders.remove(uuid);
    return { data: null };
  }

  @Put('selection')
  async setSelection(@Body() body: unknown) {
    return {
      data: await this.aiProviders.setSelection(SetAiProviderSelectionInputSchema.parse(body)),
    };
  }

  @Post(':uuid/test')
  async test(@Param('uuid') uuid: string, @Body() body: unknown) {
    return {
      data: await this.aiProviders.test(uuid, AiProviderTestInputSchema.parse(body).task),
    };
  }
}
