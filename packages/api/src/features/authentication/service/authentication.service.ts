import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AuthenticatedUser, ChangePasswordInput, LoginInput, UserDirectoryResponseSchema } from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { UserStore } from '../stores/user.store';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { User } from '../models/user.entity';
import { ScopedUser } from '../decorators/current-user.decorator';

@Injectable()
export class AuthenticationService {
  private readonly logger = new BinderLogger(AuthenticationService.name);

  constructor(
    private readonly users: UserStore,
    private readonly config: ConfigService<BinderConfig>
  ) { }

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
    const user = await this.users.findOneNamed("findByUsername", {}, { username:input.username });
    if (user === null) {
      this.logger.debug(`user ${input.username} not found`)
    }
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    user.lastLoginAt = new Date();
    await this.users.update(user.uuid, user);
    return this.toAuthenticatedUser(user);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.update(user.uuid, {
      ...user,
      passwordHash: await argon2.hash(input.newPassword),
      mustChangePassword: false
    });

    return this.toAuthenticatedUser(user);
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.users.findById(userId);
    return user && user.isActive ? this.toAuthenticatedUser(user) : null;
  }

  async listActiveUsers() {
    const users = await this.users.findAllNamed('findActiveUsers');
    return UserDirectoryResponseSchema.parse({
      items: users.map((user) => ({
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }))
    });
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      uuid: user.uuid,
      username: user.username,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword
    };
  }

  async validateSSOUser(eMail: string): Promise<{
    user: Partial<User>;
  }> {
    const existingUser = await this.users.findOneNamed(
      'findByEmail',
      undefined,
      { email: eMail },
    );
    if (!existingUser) {
      throw new Error('User does not exist');
    }
    const scu: ScopedUser = {
      userId: existingUser.uuid,
      username: existingUser.username,
      email: existingUser.email,
      isAdmin: existingUser.isAdmin,
      jti: '',
      scope: '',
      role: existingUser.isAdmin ? 'admin' : 'user',
    };

    // Return user without password
    const userWithoutPassword = this.excludePassword(existingUser);

    this.logger.debug(`User logged in successfully: ${existingUser.email}`);

    return {
      user: userWithoutPassword
    };
  }

  /**
 * Exclude password from user object
 * Removes sensitive data before sending to client
 *
 * @param user - User object
 * @returns User object without passwordHash
 */
  private excludePassword(user: User): Partial<User> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars
    const { passwordHash, ...userWithoutPassword } = user.toJSON();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return userWithoutPassword;
  }
}
