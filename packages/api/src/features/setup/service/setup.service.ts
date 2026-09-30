import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthenticatedUser, AuthenticatedUserSchema, SetupAdminInput, SetupStatus, SetupStatusSchema } from '@binder/common';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { SetupAlreadyCompletedError, SetupStateStore } from '../store/setup-state.store';

@Injectable()
export class SetupService {
  constructor(
    private readonly setupState: SetupStateStore,
    private readonly config: ConfigService<BinderConfig>
  ) {}

  async status(): Promise<SetupStatus> {
    const required = await this.setupState.isRequired();
    return SetupStatusSchema.parse({
      required,
      available: required && Boolean(this.config.get<string>(ConfigKeys.SETUP_SECRET))
    });
  }

  async createAdministrator(input: SetupAdminInput): Promise<AuthenticatedUser> {
    const status = await this.status();
    if (!status.required) {
      throw new ConflictException('Initial administrator setup is already complete');
    }

    const configuredSecret = this.config.get<string>(ConfigKeys.SETUP_SECRET);
    if (!configuredSecret || !this.secretsMatch(input.setupSecret, configuredSecret)) {
      throw new UnauthorizedException('The setup secret is invalid');
    }

    try {
      const user = await this.setupState.createInitialAdministrator({
        username: input.username.trim().toLowerCase(),
        passwordHash: await argon2.hash(input.password)
      });

      return AuthenticatedUserSchema.parse({
        uuid: user.uuid,
        username: user.username,
        isAdmin: user.isAdmin,
        mustChangePassword: user.mustChangePassword
      });
    } catch (error) {
      if (error instanceof SetupAlreadyCompletedError) {
        throw new ConflictException('Initial administrator setup is already complete');
      }
      throw error;
    }
  }

  private secretsMatch(provided: string, configured: string): boolean {
    const providedDigest = createHash('sha256').update(provided).digest();
    const configuredDigest = createHash('sha256').update(configured).digest();
    return timingSafeEqual(providedDigest, configuredDigest);
  }
}
