import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ChangePasswordInputSchema,
  CreateManagedUserInputSchema,
  LoginInputSchema,
  PasswordResetConfirmInputSchema,
  PasswordResetRequestInputSchema,
  ResetManagedUserPasswordInputSchema,
  UpdateManagedUserInputSchema,
  UserDirectoryResponseSchema,
} from '@binder/common';
import type { Request, Response } from 'express';
import { AuthenticationService } from '../service/authentication.service';
import { SessionRequest } from '../models/request.model';
import { AuthenticationGuard } from '../guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ensureCsrfToken } from '../../../shared/security/csrf-token';
import { CurrentUser, ScopedUser } from '../decorators/current-user.decorator';
import { UserManagementService } from '../service/user-management.service';
import { PasswordResetService } from '../service/password-reset.service';
import { NativeSSOAuthCodeStore } from '../stores/native-sso-auth-code.store';
import { AuthenticationSessionStore } from '../stores/authentication-session.store';
import { z } from 'zod';
import { ConfigService } from '@nestjs/config';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';

@Controller('auth')
export class AuthenticationController {
  private readonly logger = new Logger(AuthenticationController.name);

  constructor(
    private readonly authentication: AuthenticationService,
    private readonly userManagement: UserManagementService,
    private readonly passwordReset: PasswordResetService,
    private readonly nativeSSOAuthCodes: NativeSSOAuthCodeStore,
    private readonly sessions: AuthenticationSessionStore,
    private readonly appConfig: ConfigService<BinderConfig>,
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
    return this.establishSession(request, result.uuid, result.mustChangePassword, result);
  }

  @Post('native/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async nativeLogin(
    @Body() body: unknown,
    @Req() request: SessionRequest,
    @Headers('content-type') contentType?: string,
  ) {
    if (!contentType?.toLowerCase().startsWith('application/json')) {
      throw new UnauthorizedException('Native login requires a JSON request');
    }
    const result = await this.authentication.login(LoginInputSchema.parse(body));
    return this.establishSession(request, result.uuid, result.mustChangePassword, result);
  }

  @Post('native/sso/exchange')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exchangeNativeSSO(@Body() body: unknown, @Req() request: SessionRequest) {
    const input = z
      .object({
        code: z.string().min(20).max(128),
        codeVerifier: z
          .string()
          .min(43)
          .max(128)
          .regex(/^[A-Za-z0-9._~-]+$/),
      })
      .parse(body);
    const grant = await this.nativeSSOAuthCodes.consume(input.code, input.codeVerifier);
    if (!grant) throw new UnauthorizedException('SSO authorization code is invalid or expired');
    const user = await this.authentication.getAuthenticatedUser(grant.userUuid);
    if (!user) throw new UnauthorizedException('SSO user is no longer active');
    return this.establishSession(request, grant.userUuid, user.mustChangePassword, user);
  }

  private async establishSession(
    request: SessionRequest,
    userId: string,
    mustChangePassword: boolean,
    responseData: unknown,
  ) {
    const rootUri = this.appConfig.get<string>(ConfigKeys.ROOT_URI);
    const trustedProxies = this.appConfig.get<string>(ConfigKeys.TRUST_PROXY) ?? '(unset)';
    this.logger.debug(
      `Auth session issuance diagnostics (peer=${request.socket.remoteAddress ?? 'unknown'}, secure=${request.secure}, protocol=${request.protocol}, x-forwarded-proto=${request.get('x-forwarded-proto') ?? 'missing'}, root-uri-https=${rootUri?.startsWith('https://') ?? false}, trust-proxy=${trustedProxies})`,
    );
    if (rootUri?.startsWith('https://') && !request.secure) {
      // express-session suppresses Secure cookies unless Express recognizes
      // the incoming request as HTTPS through TLS or a trusted proxy header.
      this.logger.warn(
        `HTTPS ROOT_URI but authenticated request is not secure (peer=${request.socket.remoteAddress ?? 'unknown'}, protocol=${request.protocol}, x-forwarded-proto=${request.get('x-forwarded-proto') ?? 'missing'}); check TRUST_PROXY and proxy headers`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = userId;
    request.session.mustChangePassword = mustChangePassword;
    const csrfToken = ensureCsrfToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });
    return { data: responseData, csrfToken };
  }

  @Post('password-reset/request')
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  async requestPasswordReset(@Body() body: unknown): Promise<{ data: { accepted: true } }> {
    const input = PasswordResetRequestInputSchema.parse(body);
    return { data: await this.passwordReset.request(input.identifier) };
  }

  @Post('password-reset/confirm')
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async confirmPasswordReset(@Body() body: unknown): Promise<{ data: { accepted: boolean } }> {
    const input = PasswordResetConfirmInputSchema.parse(body);
    return { data: await this.passwordReset.confirm(input.token, input.newPassword) };
  }

  @Get('password-reset/validate')
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  async validatePasswordReset(
    @Query('token') token: string,
  ): Promise<{ data: { valid: boolean } }> {
    return {
      data: { valid: token?.length >= 20 ? await this.passwordReset.isValid(token) : false },
    };
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
    const userUuid = request.session.userId;
    if (!userUuid) {
      throw new UnauthorizedException();
    }
    const result = await this.authentication.changePassword(
      userUuid,
      ChangePasswordInputSchema.parse(body),
    );
    await this.sessions.invalidateOtherSessions(userUuid, request.sessionID);
    return this.establishSession(request, userUuid, false, result);
  }

  @Post('logout')
  async logout(
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: null }> {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    // Remove the browser's now-invalid session ID so the next SSO start cannot
    // accidentally continue from the destroyed session cookie.
    response.clearCookie('connect.sid', { path: '/' });
    return { data: null };
  }
}
