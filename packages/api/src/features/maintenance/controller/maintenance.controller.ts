import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { MaintenanceService } from '../service/maintenance.service';

@Controller('maintenance')
@UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
@Roles('admin')
@Scopes(['web'])
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('status')
  async status() {
    return { data: await this.maintenance.getStatus() };
  }

  @Post('backup')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestBackup() {
    return { data: await this.maintenance.requestBackup() };
  }
}
