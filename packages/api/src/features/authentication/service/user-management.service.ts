import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  CreateManagedUserInput,
  ManagedUser,
  ManagedUserListResponseSchema,
  ManagedUserResponseSchema,
  ResetManagedUserPasswordInput,
  UpdateManagedUserInput,
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { User } from '../models/user.entity';
import { UserStore } from '../stores/user.store';

@Injectable()
export class UserManagementService {
  private readonly logger = new BinderLogger(UserManagementService.name);

  constructor(private readonly users: UserStore) {}

  async list() {
    const users = await this.users.findManagedUsers();
    return ManagedUserListResponseSchema.parse({
      items: users.map((user) => this.toResponse(user)),
    });
  }

  async create(input: CreateManagedUserInput) {
    const username = input.username.trim();
    const email = this.normalizeEmail(input.email);
    await this.assertUnique(username, email);

    const passwordHash = input.password ? await argon2.hash(input.password) : null;
    try {
      const user = await this.users.create({
        username,
        email,
        passwordHash,
        isAdmin: input.isAdmin,
        isActive: true,
        mustChangePassword: Boolean(input.password),
        lastLoginAt: null,
      });
      return ManagedUserResponseSchema.parse({ user: this.toResponse(user) });
    } catch (error) {
      this.rethrowUniqueError(error);
      throw error;
    }
  }

  async update(actorUuid: string, uuid: string, input: UpdateManagedUserInput) {
    const user = await this.requireUser(uuid);
    const username = input.username?.trim();
    const email = input.email === undefined ? undefined : this.normalizeEmail(input.email);

    if (username || email !== undefined) {
      await this.assertUnique(
        username ?? user.username,
        email === undefined ? user.email : email,
        uuid,
      );
    }

    const isActive = input.isActive ?? user.isActive;
    const isAdmin = input.isAdmin ?? user.isAdmin;
    this.assertActorCanChangeAccount(actorUuid, user, isActive, isAdmin);
    await this.assertActiveAdministratorRemains(user, isActive, isAdmin);

    try {
      const updated = await this.users.update(user.uuid, {
        ...(username === undefined ? {} : { username }),
        ...(email === undefined ? {} : { email }),
        ...(input.isAdmin === undefined ? {} : { isAdmin }),
        ...(input.isActive === undefined ? {} : { isActive }),
      });
      if (!updated) throw new NotFoundException('User not found');
      return ManagedUserResponseSchema.parse({ user: this.toResponse(updated) });
    } catch (error) {
      this.rethrowUniqueError(error);
      throw error;
    }
  }

  async resetPassword(actorUuid: string, uuid: string, input: ResetManagedUserPasswordInput) {
    const user = await this.requireUser(uuid);
    if (!user.isActive) {
      throw new BadRequestException(
        'An inactive user must be activated before resetting the password',
      );
    }

    const updated = await this.users.update(user.uuid, {
      passwordHash: await argon2.hash(input.newPassword),
      mustChangePassword: true,
    });
    if (!updated) throw new NotFoundException('User not found');

    this.logger.info('Administrator reset a user password', {
      actorUuid,
      userUuid: uuid,
    });
    return ManagedUserResponseSchema.parse({ user: this.toResponse(updated) });
  }

  private async requireUser(uuid: string): Promise<User> {
    const user = await this.users.findById(uuid);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async assertUnique(
    username: string,
    email: string | null,
    excludeUuid?: string,
  ): Promise<void> {
    const existingUsername = await this.users.findByUsernameInsensitive(username, excludeUuid);
    if (existingUsername) throw new ConflictException('A user with this username already exists');

    if (email) {
      const existingEmail = await this.users.findByEmailInsensitive(email, excludeUuid);
      if (existingEmail) throw new ConflictException('A user with this email already exists');
    }
  }

  private assertActorCanChangeAccount(
    actorUuid: string,
    user: User,
    isActive: boolean,
    isAdmin: boolean,
  ): void {
    if (actorUuid !== user.uuid) return;
    if (!isActive) throw new ForbiddenException('You cannot deactivate your own account');
    if (!isAdmin)
      throw new ForbiddenException('You cannot remove administrator access from yourself');
  }

  private async assertActiveAdministratorRemains(
    user: User,
    isActive: boolean,
    isAdmin: boolean,
  ): Promise<void> {
    if (user.isAdmin && user.isActive && (!isAdmin || !isActive)) {
      const activeAdministrators = await this.users.countActiveAdmins();
      if (activeAdministrators <= 1) {
        throw new ConflictException('At least one active administrator must remain');
      }
    }
  }

  private normalizeEmail(email: string | null | undefined): string | null {
    const normalized = email?.trim().toLowerCase();
    return normalized || null;
  }

  private rethrowUniqueError(error: unknown): void {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw new ConflictException('A user with this username or email already exists');
    }
  }

  private toResponse(user: User): ManagedUser {
    return {
      uuid: user.uuid,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
