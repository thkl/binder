import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Request } from 'express';
import { BinderConfig, ConfigKeys } from '../config/config.keys';

/**
 * Custom Throttler Guard
 * Only applies rate limiting to API routes (/api/*)
 *
 * Protects API endpoints from abuse while allowing
 * unrestricted access to static files and frontend routes.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService<BinderConfig>,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Determines if throttling should be skipped for this request
   * Only throttles routes that start with /api
   *
   * @param context - Execution context
   * @returns true if throttling should be skipped (non-API routes), false otherwise
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path || request.url;

    const configuredPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    const normalizedPrefix = `/${configuredPrefix.replace(/^\/+|\/+$/g, '')}`;

    // Only throttle configured API routes. Static files and Angular routes remain unrestricted.
    const isApiRoute = path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);

    if (!isApiRoute) {
      // Skip throttling for non-API routes (static files, frontend routes)
      return true;
    }

    // Call parent shouldSkip for other skip logic (like @SkipThrottle decorator)
    return super.shouldSkip(context);
  }
}
