import { Controller, Delete, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { SessionRequest } from '../../authentication/models/request.model';
import { DropboxConnectionService } from '../service/dropbox-connection.service';

@Controller('maintenance/dropbox')
export class DropboxController {
  constructor(private readonly dropbox: DropboxConnectionService) {}

  @Get('status')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async status() {
    return { data: await this.dropbox.status() };
  }

  @Get('connect')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  connect(@Req() request: SessionRequest, @Res() response: Response) {
    const returnTo = request.query.returnTo;
    return this.dropbox.authorize(
      request,
      response,
      typeof returnTo === 'string' ? returnTo : undefined,
    );
  }

  @Get('callback')
  callback(@Req() request: SessionRequest, @Res() response: Response) {
    return this.dropbox.callback(request, response);
  }

  @Delete('connection')
  @UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
  @Roles('admin')
  @Scopes(['web'])
  async disconnect() {
    await this.dropbox.disconnect();
    return { data: null };
  }
}
