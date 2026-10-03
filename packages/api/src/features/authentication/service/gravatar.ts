import { createHash } from 'node:crypto';

export function createGravatarUrl(email: string | null | undefined): string | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const emailHash = createHash('md5').update(normalizedEmail, 'utf8').digest('hex');
  return `https://www.gravatar.com/avatar/${emailHash}?d=404&s=96`;
}
