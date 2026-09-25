import { Injectable } from '@nestjs/common';
import { DatabaseConnectionService } from '../../../database/service/database-connection.service';
import { User, UserAttributes, UserCreationAttributes } from '../models/user.entity';

@Injectable()
export class UserStore {
  constructor(private readonly database: DatabaseConnectionService) {

  }

  count(): Promise<number> {
    return this.database.executeWithConnection(() => User.count());
  }

  findById(id: string): Promise<User | null> {
    return this.database.executeWithConnection(() => User.findByPk(id));
  }

  findByUsername(username: string): Promise<User | null> {
    return this.database.executeWithConnection(() =>
      User.findOne({ where: { username: username.trim().toLowerCase() } })
    );
  }

  create(values: UserCreationAttributes): Promise<User> {
    return this.database.executeWithConnection(() => User.create(values));
  }

  update(user: User, values: Partial<UserAttributes>): Promise<User> {
    return this.database.executeWithConnection(async () => {
      await user.update(values);
      return user;
    });
  }
}
