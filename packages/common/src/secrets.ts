import { readFileSync, statSync } from 'node:fs';

export class SecretResolver {
  private readonly cache = new Map<string, string>();

  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  get(name: string): string | undefined {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const direct = this.environment[name]?.trim();
    if (direct) {
      this.cache.set(name, direct);
      return direct;
    }

    const filePath = this.environment[`${name}_FILE`]?.trim();
    if (!filePath) return undefined;
    let stats;
    try {
      stats = statSync(filePath);
      if (!stats.isFile()) throw new Error('path is not a regular file');
      const secret = readFileSync(filePath, 'utf8').trim();
      if (!secret) throw new Error('file is empty');
      this.cache.set(name, secret);
      return secret;
    } catch (error) {
      throw new Error(
        `Unable to read secret ${name}_FILE (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  require(name: string): string {
    const value = this.get(name);
    if (!value) throw new Error(`Missing required secret ${name} or ${name}_FILE`);
    return value;
  }
}

export const secrets = new SecretResolver();
