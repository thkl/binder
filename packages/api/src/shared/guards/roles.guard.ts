/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BinderLogger } from '../service/logger.helper';

/**
 * Roles Guard
 * Checks if user has required role to access endpoint
 * Must be used with @Roles() decorator and JwtAuthGuard
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('admin')
 * @Get('/admin-only')
 * getAdminEndpoint() { ... }
 *
 * If no @Roles() decorator is present, allows all authenticated users
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new BinderLogger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from @Roles() decorator
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    // If no roles specified, allow access (will be protected by JwtAuthGuard)
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    const user = request.user;

    if (!user) {
      this.logger.warn('RolesGuard: No user in request');
      return false;
    }

    // Check if user's role is in required roles

    const hasRole = requiredRoles.some((role) => user?.role === role);

    if (!hasRole) {
      this.logger.warn(
        `User ${user.userId} (role: ${user.role}) attempted to access endpoint requiring roles: ${requiredRoles.join(', ')}`,
      );
    }

    return hasRole;
  }
}
