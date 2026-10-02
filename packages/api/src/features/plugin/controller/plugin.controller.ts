import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { PluginService } from '../service/plugin.service';

@Controller('plugins')
@UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
@Roles('admin')
@Scopes(['web'])
export class PluginController {
  constructor(private readonly plugins: PluginService) {}

  @Get()
  list() {
    return { data: this.plugins.list() };
  }
}
