import { SetMetadata } from '@nestjs/common';

/**
 * Scopes Decorator
 * Marks endpoint with allowed JWT scopes (any match grants access)
 * Must be used with ScopeGuard
 *
 * Usage:
 * @Scopes(['api'])              // Only API tokens
 * @Scopes(['api', 'web'])       // Either API or web tokens
 * @Scopes(['api', 'web', 'admin']) // Any of these scopes
 *
 * @param scopes - Array of scope strings (e.g., ['api', 'web', 'admin'])
 */
export const Scopes = (scopes: string[]) => SetMetadata('scopes', scopes);
