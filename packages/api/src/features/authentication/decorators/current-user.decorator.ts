import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ScopedUser {
  userId: string;
  email?: string|null;
  username: string;
  jti: string;
  scope: string;
  isAdmin: boolean;
}

/**
 * Current User Decorator
 * Injects the current authenticated user into controller method parameter
 *
 * Usage:
 * @Get('/profile')
 * getProfile(@CurrentUser() user: any) {
 *   return user; // Contains: userId, email, role, firstName, lastName
 * }
 *
 * Can only be used on endpoints protected by JwtAuthGuard
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = ctx.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return request.user;
  },
);
