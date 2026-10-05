import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserStore } from './stores/user.store';
import { ApiToken } from './models/api-token.entity';
import { User } from './models/user.entity';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([User, ApiToken])],
  providers: [UserStore],
  exports: [UserStore],
})
export class AuthenticationStoreModule {}
