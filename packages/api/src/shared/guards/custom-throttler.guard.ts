import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Custom Throttler Guard
 * Only applies rate limiting to API routes (/api/*)
 *
 * Protects API endpoints from abuse while allowing
 * unrestricted access to static files and frontend routes.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
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

    // Only throttle /api routes
    const isApiRoute = path.startsWith('/api');

    if (!isApiRoute) {
      // Skip throttling for non-API routes (static files, frontend routes)
      return true;
    }

    // Call parent shouldSkip for other skip logic (like @SkipThrottle decorator)
    return super.shouldSkip(context);
  }
}
