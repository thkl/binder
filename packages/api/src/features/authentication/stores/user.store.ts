import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { IStoreUser, NamedQueryAddingOptions } from '../../../shared/datastore/query-options.type';
import { User } from '../models/user.entity';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';

export type UserStoreQueries = {
  findByEmail: { email: string };
  findActiveUsers: object;
  findByUsername: { username: string };
};

/**
 * Find user by email
 * Used for login and email lookups
 */
const findByEmail: NamedQueryAddingOptions<User> = {
  name: 'findByEmail',
  findOptions: {
    where: { email: '$email' },
  },
};

/**
 * Find all active users
 * Excludes inactive/disabled accounts
 */
const findActiveUsers: NamedQueryAddingOptions<User> = {
  name: 'findActiveUsers',
  findOptions: {
    where: { isActive: true },
    attributes: ['uuid', 'username', 'email', 'isAdmin'],
    order: [['username', 'ASC']],
  },
};

/**
 * User Store
 * Data access layer for User model
 * Provides CRUD operations and named queries for user lookups
 *
 * Named Queries:
 * - findByEmail: Find user by email (for login)
 * - findActiveUsers: Find all active users (for admin operations)
 */
@Injectable()
export class UserStore extends BaseCrudStore<User, IStoreUser, UserStoreQueries> {
  constructor() {
    super(User);
    this.registerIdField('uuid');
  }

  protected registerNamedQueries(): void {
    this.addNamedQueryWithOptions(findByEmail);
    this.addNamedQueryWithOptions(findActiveUsers);
    this.addNamedQueryWithOptions({
      name: 'findByUsername',
      findOptions: {
        where: { username: '$username' },
      },
      parameters: [{ name: 'username', type: 'string' }],
    });
  }

  async findManagedUsers(): Promise<User[]> {
    return this.model.findAll({
      attributes: [
        'uuid',
        'username',
        'email',
        'isAdmin',
        'isActive',
        'mustChangePassword',
        'lastLoginAt',
        'createdAt',
        'updatedAt',
      ],
      order: [['username', 'ASC']],
    });
  }

  async findByUsernameInsensitive(username: string, excludeUuid?: string): Promise<User | null> {
    return this.model.findOne({
      where: {
        username: { [Op.iLike]: username },
        ...(excludeUuid ? { uuid: { [Op.ne]: excludeUuid } } : {}),
      },
    });
  }

  async findByLogin(login: string): Promise<User | null> {
    const normalized = login.trim();
    return this.model.findOne({
      where: {
        [Op.or]: [
          { username: { [Op.iLike]: normalized } },
          { email: { [Op.iLike]: normalized.toLowerCase() } },
        ],
      },
    });
  }

  async findByEmailInsensitive(email: string, excludeUuid?: string): Promise<User | null> {
    return this.model.findOne({
      where: {
        email: { [Op.iLike]: email },
        ...(excludeUuid ? { uuid: { [Op.ne]: excludeUuid } } : {}),
      },
    });
  }

  async countActiveAdmins(): Promise<number> {
    return this.model.count({ where: { isAdmin: true, isActive: true } });
  }
}
