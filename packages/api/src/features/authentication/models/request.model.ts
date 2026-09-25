import type { Request } from 'express';

export type SessionRequest = Request & {
  session: Request['session'] & {
    userId?: string;
    mustChangePassword?: boolean;
    oidcState?: string;
    oidcCodeVerifier?: string;
  };
};
