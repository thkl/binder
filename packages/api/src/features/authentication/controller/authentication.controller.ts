import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ChangePasswordInputSchema,
  CreateManagedUserInputSchema,
  LoginInputSchema,
  ResetManagedUserPasswordInputSchema,
  UpdateManagedUserInputSchema,
  UserDirectoryResponseSchema,
  CreateApiTokenInputSchema,
} from '@binder/common';
import type { Request } from 'express';
import { AuthenticationService } from '../service/authentication.service';
import { SessionRequest } from '../models/request.model';
import { AuthenticationGuard } from '../guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ensureCsrfToken } from '../../../shared/security/csrf-token';
import { CurrentUser, ScopedUser } from '../decorators/current-user.decorator';
import { UserManagementService } from '../service/user-management.service';
import { ApiTokenService } from '../service/api-token.service';

@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly userManagement: UserManagementService,
    private readonly tokenService: ApiTokenService,
  ) {}

  @Get('users')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async users() {
    return { data: UserDirectoryResponseSchema.parse(await this.authentication.listActiveUsers()) };
  }

  @Get('users/managed')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async managedUsers() {
    return { data: await this.userManagement.list() };
  }

  @Post('users')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async createUser(@Body() body: unknown) {
    return { data: await this.userManagement.create(CreateManagedUserInputSchema.parse(body)) };
  }

  @Patch('users/:uuid')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async updateUser(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.userManagement.update(
        user.userId,
        uuid,
        UpdateManagedUserInputSchema.parse(body),
      ),
    };
  }

  @Post('users/:uuid/password')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async resetUserPassword(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.userManagement.resetPassword(
        user.userId,
        uuid,
        ResetManagedUserPasswordInputSchema.parse(body),
      ),
    };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: unknown, @Req() request: SessionRequest) {
    const result = await this.authentication.login(LoginInputSchema.parse(body));
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = result.uuid;
    request.session.mustChangePassword = result.mustChangePassword;
    const csrfToken = ensureCsrfToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });
    return { data: result, csrfToken };
  }

  @Get('api-tokens')
  @UseGuards(AuthenticationGuard)
  async apiTokens(@CurrentUser() user: ScopedUser) {
    return { data: await this.tokenService.list(user.userId) };
  }

  @Post('api-tokens')
  @UseGuards(AuthenticationGuard)
  async createApiToken(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.tokenService.create(user.userId, CreateApiTokenInputSchema.parse(body)),
    };
  }

  @Delete('api-tokens/:uuid')
  @UseGuards(AuthenticationGuard)
  async revokeApiToken(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    await this.tokenService.revoke(user.userId, uuid);
    return { data: null };
  }

  @Get('session')
  async session(@Req() request: SessionRequest) {
    if (!request.session.userId) {
      return { data: null, csrfToken: ensureCsrfToken(request) };
    }
    const user = await this.authentication.getAuthenticatedUser(request.session.userId);
    if (!user) {
      return { data: null, csrfToken: ensureCsrfToken(request) };
    }
    return { data: user, csrfToken: ensureCsrfToken(request) };
  }

  @Post('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@Body() body: unknown, @Req() request: SessionRequest) {
    if (!request.session.userId) {
      throw new UnauthorizedException();
    }
    const result = await this.authentication.changePassword(
      request.session.userId,
      ChangePasswordInputSchema.parse(body),
    );
    request.session.mustChangePassword = false;
    const csrfToken = ensureCsrfToken(request);
    return { data: result, csrfToken };
  }

  @Post('logout')
  async logout(@Req() request: SessionRequest): Promise<{ data: null }> {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    return { data: null };
  }
}
