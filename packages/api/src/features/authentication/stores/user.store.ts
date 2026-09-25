import { Injectable } from '@nestjs/common';
import { NamedQueryAddingOptions } from '../../../shared/datastore/query-options.type';
import { User } from '../models/user.entity';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';

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
export class UserStore extends BaseCrudStore<User> {
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
        where: {username : "$username" },
      },
      parameters:[{name:"username",type:"string"}]
    })
  }
}
