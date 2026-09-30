import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthenticationGuard } from './authentication.guard.js';
import type { AuthenticationService } from '../service/authentication.service.js';

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as never;
}

function sessionRequest(userId?: string): Record<string, unknown> {
  return {
    session: {
      ...(userId ? { userId } : {})
    }
  };
}

function guard(user: { uuid: string; username: string; isAdmin: boolean; mustChangePassword: boolean } | null): AuthenticationGuard {
  return new AuthenticationGuard({
    getAuthenticatedUser: async () => user
  } as unknown as AuthenticationService);
}

test('rejects unauthenticated requests', async () => {
  await assert.rejects(
    guard(null).canActivate(context(sessionRequest())),
    (error: unknown) => error instanceof UnauthorizedException
  );
});

test('rejects sessions that still require a password change', async () => {
  await assert.rejects(
    guard({ uuid: 'user-1', username: 'admin', isAdmin: true, mustChangePassword: true })
      .canActivate(context(sessionRequest('user-1'))),
    (error: unknown) => error instanceof ForbiddenException
  );
});

test('adds the scoped user to an authenticated request', async () => {
  const request = sessionRequest('user-1');
  assert.equal(
    await guard({ uuid: 'user-1', username: 'admin', isAdmin: true, mustChangePassword: false })
      .canActivate(context(request)),
    true
  );
  assert.deepEqual((request as { user?: unknown }).user, {
    userId: 'user-1',
    username: 'admin',
    isAdmin: true,
    role: 'admin',
    scope: 'web',
    jti: ''
  });
});
