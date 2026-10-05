import { ForbiddenException, Injectable, ExecutionContext, CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { BinderConfig, ConfigKeys } from '../config/config.keys';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService<BinderConfig>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;

    const path = request.path || request.url;
    if (path.endsWith('/ssoauth/callback')) return true;

    // Bearer-authenticated API/MCP requests do not use browser cookies, so
    // they are not exposed to the CSRF threat this guard protects against.
    const authorization = request.headers.authorization;
    if (!request.session?.userId && authorization && /^Bearer\s+/i.test(authorization)) {
      return true;
    }

    const token = this.headerValue(request.headers['x-csrf-token']);
    const sessionToken = request.session?.csrfToken;
    if (token && sessionToken && this.tokensMatch(token, sessionToken)) return true;

    if (path.endsWith('/auth/login') || path.endsWith('/setup/admin')) {
      if (this.isTrustedBrowserOrigin(request)) return true;
    }

    throw new ForbiddenException('CSRF validation failed');
  }

  private isTrustedBrowserOrigin(request: Request): boolean {
    const configuredRoot = this.config.get<string>(ConfigKeys.ROOT_URI);
    if (!configuredRoot) return false;

    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(configuredRoot).origin;
    } catch {
      return false;
    }

    const origin = this.headerValue(request.headers.origin);
    if (origin) return origin === expectedOrigin;

    const referer = this.headerValue(request.headers.referer);
    if (!referer) return false;
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private tokensMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
