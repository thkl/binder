import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    mustChangePassword?: boolean;
    csrfToken?: string;
    dropboxState?: string;
    dropboxCodeVerifier?: string;
    dropboxReturnTo?: string;
  }
}
