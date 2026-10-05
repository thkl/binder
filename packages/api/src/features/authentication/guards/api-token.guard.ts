import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTokenService } from '../service/api-token.service';
import type { ScopedUser } from '../decorators/current-user.decorator';

type TokenRequest = Request & { user?: ScopedUser };

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly apiTokens: ApiTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TokenRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer\s+/i.test(header))
      throw new UnauthorizedException('Bearer token required');
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Bearer token required');
    request.user = await this.apiTokens.authenticate(token);
    return true;
  }
}
