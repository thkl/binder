declare module 'nodemailer' {
  export function createTransport(options: Record<string, unknown>): {
    sendMail(message: Record<string, unknown>): Promise<unknown>;
  };
}
