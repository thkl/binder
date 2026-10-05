import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'POST',
    path: '/api/v1/documents',
    headers: {},
    session: { csrfToken: 'a'.repeat(64) },
    ...overrides,
  };
}

function guard(): CsrfGuard {
  return new CsrfGuard({
    get: () => 'https://binder.example.test',
  } as never);
}

test('allows safe requests without a CSRF token', () => {
  assert.equal(guard().canActivate(context(request({ method: 'GET' }))), true);
});

test('accepts a matching CSRF token for authenticated mutations', () => {
  assert.equal(
    guard().canActivate(context(request({ headers: { 'x-csrf-token': 'a'.repeat(64) } }))),
    true,
  );
});

test('rejects authenticated mutations without a matching token', () => {
  assert.throws(
    () => guard().canActivate(context(request())),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('allows bearer-authenticated API mutations without a browser CSRF token', () => {
  assert.equal(
    guard().canActivate(
      context(request({ session: {}, headers: { authorization: 'Bearer bnd_pat_test' } })),
    ),
    true,
  );
});

test('requires the configured browser origin for login', () => {
  assert.equal(
    guard().canActivate(
      context(
        request({
          path: '/api/v1/auth/login',
          session: {},
          headers: { origin: 'https://binder.example.test' },
        }),
      ),
    ),
    true,
  );

  assert.throws(
    () =>
      guard().canActivate(
        context(
          request({
            path: '/api/v1/auth/login',
            session: {},
            headers: { origin: 'https://attacker.example.test' },
          }),
        ),
      ),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
