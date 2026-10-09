import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CsrfService } from './csrf.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!MUTATING_METHODS.has(request.method) || !request.url.includes('/api/')) {
    return next(request);
  }

  const isPublicMutation =
    request.url.endsWith('/auth/login') || request.url.endsWith('/setup/admin');
  if (isPublicMutation) return next(request);

  const token = inject(CsrfService).token();
  return token ? next(request.clone({ setHeaders: { 'X-CSRF-Token': token } })) : next(request);
};
