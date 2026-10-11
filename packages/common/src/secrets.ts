import { readFileSync, statSync } from 'node:fs';

/** Resolves configuration secrets from direct environment values or secret files. */
export class SecretResolver {
  private readonly cache = new Map<string, string>();

  /**
   * Creates a resolver backed by an environment object.
   *
   * @param {NodeJS.ProcessEnv} environment - Environment variables used to resolve secrets.
   */
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  /**
   * Returns a cached secret, a non-empty direct value, or the contents of its `_FILE` path. Direct values take precedence over file-based values.
   *
   * @param {string} name - Secret environment variable name.
   * @returns {string | undefined} - The trimmed secret, or `undefined` when neither source is configured.
   * @throws {Error} - When a configured secret file cannot be read or is empty.
   */
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

  /**
   * Resolves a required secret and fails fast when it is not configured.
   *
   * @param {string} name - Required secret environment variable name.
   * @returns {string} - The resolved secret.
   * @throws {Error} - When neither the direct value nor its `_FILE` alternative exists.
   */
  require(name: string): string {
    const value = this.get(name);
    if (!value) throw new Error(`Missing required secret ${name} or ${name}_FILE`);
    return value;
  }
}

export const secrets = new SecretResolver();
