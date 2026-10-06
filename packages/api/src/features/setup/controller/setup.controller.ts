import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  SetupAdminInputSchema,
  SetupCompletionResponseSchema,
  RecoveryBackupListInputSchema,
  SetupStatusSchema,
  SetupValidationResponseSchema,
} from '@binder/common';
import { SessionRequest } from '../../authentication/models/request.model';
import { SetupService } from '../service/setup.service';
import { ensureCsrfToken } from '../../../shared/security/csrf-token';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  async status() {
    return { data: SetupStatusSchema.parse(await this.setup.status()) };
  }

  @Post('admin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createAdmin(@Body() body: unknown, @Req() request: SessionRequest) {
    const result = await this.setup.createAdministrator(SetupAdminInputSchema.parse(body));

    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = result.uuid;
    request.session.mustChangePassword = false;
    const csrfToken = ensureCsrfToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });

    return { data: result, csrfToken };
  }

  @Post('validate-storage')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async validateStorage() {
    return { data: SetupValidationResponseSchema.parse(await this.setup.validateStorage()) };
  }

  @Post('validate-processing')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async validateProcessing() {
    return { data: SetupValidationResponseSchema.parse(await this.setup.validateProcessing()) };
  }

  @Post('validate-oidc')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async validateOidc() {
    return { data: SetupValidationResponseSchema.parse(await this.setup.validateOidc()) };
  }

  @Post('validate-backup')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async validateBackup() {
    return { data: SetupValidationResponseSchema.parse(await this.setup.validateBackup()) };
  }

  @Get('recovery/backups')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async recoveryBackups(@Body() body: unknown) {
    const input = RecoveryBackupListInputSchema.parse(body ?? {});
    return { data: await this.setup.listRecoveryBackups(input.accessToken) };
  }

  @Post('recovery/public/backups')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async publicRecoveryBackups(@Body() body: unknown) {
    const input = RecoveryBackupListInputSchema.parse(body ?? {});
    return { data: await this.setup.listPublicRecoveryBackups(input.accessToken) };
  }

  @Get('recovery/public/dropbox/connect')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async publicRecoveryDropboxConnect(@Req() request: SessionRequest, @Res() response: Response) {
    return this.setup.authorizePublicRecovery(request, response);
  }

  @Post('complete')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async complete() {
    return {
      data: SetupCompletionResponseSchema.parse(await this.setup.completeOnboarding()),
    };
  }
}
