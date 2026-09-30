export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function isSequelizeError(
  e: unknown,
): e is Error & { sql?: string; original?: Error; name: string } {
  return e instanceof Error && (e.name.startsWith('Sequelize') || 'sql' in e);
}

function isAxiosError(
  e: unknown,
): e is Error & { isAxiosError: true; response?: any; config?: any } {
  return e instanceof Error && (e as any).isAxiosError === true;
}
