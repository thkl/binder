import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ChangePasswordInputSchema, LoginInputSchema, UserDirectoryResponseSchema } from '@binder/common';
import type { Request } from 'express';
import { AuthenticationService } from '../service/authentication.service';
import { SessionRequest } from '../models/request.model';
import { AuthenticationGuard } from '../guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ensureCsrfToken } from '../../../shared/security/csrf-token';
 

@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Get('users')
  @UseGuards(AuthenticationGuard, RolesGuard)
  @Roles('admin')
  async users() {
    return { data: UserDirectoryResponseSchema.parse(await this.authentication.listActiveUsers()) };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: unknown, @Req() request: SessionRequest) {
    const result = await this.authentication.login(LoginInputSchema.parse(body));
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => error ? reject(error) : resolve());
    });
    request.session.userId = result.uuid;
    request.session.mustChangePassword = result.mustChangePassword;
    const csrfToken = ensureCsrfToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => error ? reject(error) : resolve());
    });
    return { data: result, csrfToken };
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
      ChangePasswordInputSchema.parse(body)
    );
    request.session.mustChangePassword = false;
    const csrfToken = ensureCsrfToken(request);
    return { data: result, csrfToken };
  }

  @Post('logout')
  async logout(@Req() request: SessionRequest): Promise<{ data: null }> {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve());
    });
    return { data: null };
  }
}
