import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
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
  constructor(private readonly authentication: AuthenticationService) {}

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

    request.user = {
      userId: user.uuid,
      username: user.username,
      isAdmin: user.isAdmin,
      role: user.isAdmin ? 'admin' : 'user',
      scope: 'web',
      jti: ''
    };

    return true;
  }

  private async destroySession(request: AuthenticatedRequest): Promise<void> {
    if (!request.session) {
      return;
    }

    await new Promise<void>((resolve) => {
      request.session.destroy(() => resolve());
    });
  }
}

