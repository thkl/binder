/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BinderLogger } from '../service/logger.helper';

/**
 * Scope Guard
 * Checks if JWT token scope matches at least one of the allowed scopes
 * Must be used with @Scopes() decorator and JwtAuthGuard
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, ScopeGuard)
 * @Scopes(['api'])           // Only API tokens
 * @Scopes(['api', 'web'])    // Either API or web tokens
 * @Get('/endpoint')
 * getEndpoint() { ... }
 *
 * IMPORTANT: @Scopes() decorator is REQUIRED. Endpoints without @Scopes() will be denied.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  private readonly logger = new BinderLogger(ScopeGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required scopes from @Scopes() decorator
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      'scopes',
      [context.getHandler(), context.getClass()],
    );

    // If no scopes specified, DENY access (require explicit @Scopes decorator)
    if (!requiredScopes || requiredScopes.length === 0) {
      this.logger.warn(
        'ScopeGuard: No @Scopes() decorator found on endpoint, denying access',
      );
      return false;
    }

    const request = context.switchToHttp().getRequest();

    const user = request.user;

    if (!user) {
      this.logger.warn('ScopeGuard: No user in request');
      return false;
    }

    // Check if user's scope is in required scopes
    const userScope = user?.scope as string | undefined;

    if (!userScope) {
      this.logger.warn(
        `User ${user.userId} has no scope in JWT token, denying access to endpoint requiring scopes: ${requiredScopes.join(', ')}`,
      );
      return false;
    }

    const hasScope = requiredScopes.includes(userScope);

    if (!hasScope) {
      this.logger.warn(
        `User ${user.userId} (scope: ${userScope}) attempted to access endpoint requiring scopes: ${requiredScopes.join(', ')}`,
      );
    }

    return hasScope;
  }
}
