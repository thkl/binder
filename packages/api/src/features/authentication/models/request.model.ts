import type { Request } from 'express';
import type { ScopedUser } from '../decorators/current-user.decorator';

export type SessionRequest = Request & {
  session: Request['session'] & {
    userId?: string;
    mustChangePassword?: boolean;
    csrfToken?: string;
    oidcState?: string;
    oidcCodeVerifier?: string;
  };
  user?: ScopedUser;
};
