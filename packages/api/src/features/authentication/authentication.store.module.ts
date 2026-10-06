import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserStore } from './stores/user.store';
import { User } from './models/user.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { PasswordResetTokenStore } from './stores/token.store';

@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([User])],
  providers: [UserStore, PasswordResetTokenStore],
  exports: [UserStore, PasswordResetTokenStore],
})
export class AuthenticationStoreModule {}
