import { SetMetadata } from '@nestjs/common';

/**
 * Roles Decorator
 * Marks endpoint with required user roles
 * Must be used with RolesGuard
 *
 * Usage:
 * @Roles('admin')
 * @Roles('admin', 'moderator')
 *
 * @param roles - One or more role strings (e.g., 'admin', 'user')
 */
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
