import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiTokenPermission } from '@binder/common';
import type { ScopedUser } from '../../features/authentication/decorators/current-user.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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
