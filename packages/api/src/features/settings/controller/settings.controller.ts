import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApplicationSettingsResponse,
  ApplicationSettingsResponseSchema,
  SaveAllApplicationSettingsInputSchema,
  SetApplicationSettingInputSchema
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { ApplicationSettingsService } from '../service/application-settings.service';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';

import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { SetApplicationSettingDto } from '../models/dto/settings.dto';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';

@Controller('settings')
@UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
export class SettingsController {
  private readonly logger = new BinderLogger(SettingsController.name);

  constructor(private readonly settingsService: ApplicationSettingsService) {}

  @Get('')
  @Roles('admin') // Restrict to admins only
  @Scopes(['web'])
  async getAllSettings(@CurrentUser() user: ScopedUser): Promise<{ data: ApplicationSettingsResponse }> {
    this.logger.debug(`getAllSettings for ${user.email}`);
    const allSettings = await this.settingsService.getAll();
    return { data: ApplicationSettingsResponseSchema.parse(allSettings) };
  }

  @Post('')
  @Roles('admin') // Restrict to admins only
  @Scopes(['web'])
  async createNewSettingsItem(@Body() body: SetApplicationSettingDto): Promise<{ data: null }> {
    const input = SetApplicationSettingInputSchema.parse(body);
    await this.settingsService.set(input.key, input.value, input.isEncrypted, input.description);
    return { data: null };
  }

  @Post('all')
  @Roles('admin') // Restrict to admins only
  @Scopes(['web'])
  async saveAllSettings(@Body() body: SetApplicationSettingDto[]): Promise<{ data: ApplicationSettingsResponse }> {
    const settings = SaveAllApplicationSettingsInputSchema.parse(body);
    await Promise.all(settings.map((setting) => this.settingsService.set(
      setting.key,
      setting.value,
      setting.isEncrypted,
      setting.description
    )));

    const allSettings = await this.settingsService.getAll();
    return { data: ApplicationSettingsResponseSchema.parse(allSettings) };
  }
}
