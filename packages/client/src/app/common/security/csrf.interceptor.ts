import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ApplicationService } from '../application.service';
import { CsrfService } from './csrf.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!MUTATING_METHODS.has(request.method) || !request.url.includes('/api/')) {
    return next(request);
  }

  const headers: Record<string, string> = inject(ApplicationService).isNativeMobile()
    ? { 'X-Binder-Mobile-App': 'capacitor' }
    : {};
  const isPublicMutation =
    request.url.endsWith('/auth/login') || request.url.endsWith('/setup/admin');
  if (isPublicMutation) {
    return next(Object.keys(headers).length ? request.clone({ setHeaders: headers }) : request);
  }

  const token = inject(CsrfService).token();
  if (token) headers['X-CSRF-Token'] = token;
  return next(Object.keys(headers).length ? request.clone({ setHeaders: headers }) : request);
};
