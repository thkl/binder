import { randomBytes } from 'node:crypto';
import type { SessionRequest } from '../../features/authentication/models/request.model';

export function ensureCsrfToken(request: SessionRequest): string {
  request.session.csrfToken ??= randomBytes(32).toString('hex');
  return request.session.csrfToken;
}
