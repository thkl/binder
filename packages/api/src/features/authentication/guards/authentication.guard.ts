import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticationService } from '../service/authentication.service';
import type { ScopedUser } from '../decorators/current-user.decorator';
import type { SessionRequest } from '../models/request.model';

type AuthenticatedRequest = SessionRequest & Request & { user?: ScopedUser };

/**
 * Authenticates requests backed by the Express session.
 *
 * This guard intentionally only establishes identity. Role and scope checks
 * remain the responsibility of RolesGuard and ScopeGuard.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  /**
   * Resolves the persisted session identity through the authentication service.
   *
   * @param {AuthenticationService} authentication - Authentication service used to validate the session.
   */
  constructor(private readonly authentication: AuthenticationService) {}

  /**
   * Rejects missing, inactive, or password-change-required sessions before the route runs.
   *
   * @param {ExecutionContext} context - Framework execution context for the current request.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.session?.userId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.authentication.getAuthenticatedUser(userId);
    if (!user) {
      await this.destroySession(request);
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (user.mustChangePassword) {
      throw new ForbiddenException('Password change required');
    }

    request.user = {
      userId: user.uuid,
      username: user.username,
      isAdmin: user.isAdmin,
      role: user.isAdmin ? 'admin' : 'user',
      scope: 'web',
      jti: '',
    };

    return true;
  }

  /**
   * Removes a session from the store after its user is no longer valid.
   *
   * @param {AuthenticatedRequest} request - Incoming HTTP request to inspect.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private async destroySession(request: AuthenticatedRequest): Promise<void> {
    if (!request.session) {
      return;
    }

    await new Promise<void>((resolve) => {
      request.session.destroy(() => resolve());
    });
  }
}
