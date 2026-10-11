import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiTokenPermission } from '@binder/common';
import type { ScopedUser } from '../../features/authentication/decorators/current-user.decorator';

/** Enforces API-token permissions attached to a route or its controller. */
@Injectable()
export class PermissionGuard implements CanActivate {
  /**
   * Reads route permission metadata and checks it against the authenticated token user.
   *
   * @param {Reflector} reflector - NestJS reflector used to read route metadata.
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Allows unannotated routes and rejects token users missing every required permission.
   *
   * @param {ExecutionContext} context - Framework execution context for the current request.
   * @returns {boolean} - true when the operation succeeds; otherwise, false.
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiTokenPermission[]>('permissions', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: ScopedUser }>().user;
    if (!user || !required.some((permission) => user.permissions?.includes(permission))) {
      throw new ForbiddenException('API token does not have permission for this action');
    }
    return true;
  }
}
