import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserStore } from './stores/user.store';
import { User } from './models/user.entity';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([User])],
  providers: [UserStore],
  exports: [UserStore],
})
export class AuthenticationStoreModule {}
