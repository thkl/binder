import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AuthenticatedUser, ChangePasswordInput, LoginInput } from '@binder/common';
import { BinderConfig, ConfigKeys } from '../../shared/config/config.keys';
import { BinderLogger } from '../../shared/service/logger.helper';
import { User } from './models/user.entity';
import { UserStore } from './stores/user.store';

@Injectable()
export class AuthenticationService {
  private readonly logger = new BinderLogger(AuthenticationService.name);

  constructor(
    private readonly users: UserStore,
    private readonly config: ConfigService<BinderConfig>
  ) {}

  async ensureBootstrapAdmin(): Promise<void> {
    if (await this.users.count() > 0) {
      return;
    }

    const username = (this.config.get<string>(ConfigKeys.INITIAL_ADMIN_USERNAME) ?? 'admin')
      .trim()
      .toLowerCase();
    const temporaryPassword = randomBytes(24).toString('base64url');

    await this.users.create({
      username,
      passwordHash: await argon2.hash(temporaryPassword),
      isAdmin: true,
      isActive: true,
      mustChangePassword: true
    });

    this.logger.warn(
      `Bootstrap administrator created for ${username}. Temporary password: ${temporaryPassword}. ` +
      'Change it immediately after first login.'
    );
  }

  async login(input: LoginInput): Promise<AuthenticatedUser> {
    const user = await this.users.findByUsername(input.username);
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.update(user, { lastLoginAt: new Date() });
    return this.toAuthenticatedUser(user);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.update(user, {
      passwordHash: await argon2.hash(input.newPassword),
      mustChangePassword: false
    });

    return this.toAuthenticatedUser(user);
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.users.findById(userId);
    return user && user.isActive ? this.toAuthenticatedUser(user) : null;
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword
    };
  }
}
