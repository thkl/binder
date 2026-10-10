import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserStore } from './stores/user.store';
import { User } from './models/user.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { PasswordResetTokenStore } from './stores/token.store';
import { NativeSSOAuthCode } from './models/native-sso-auth-code.entity';
import { NativeSSOAuthCodeStore } from './stores/native-sso-auth-code.store';

@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([User, NativeSSOAuthCode])],
  providers: [UserStore, PasswordResetTokenStore, NativeSSOAuthCodeStore],
  exports: [UserStore, PasswordResetTokenStore, NativeSSOAuthCodeStore],
})
export class AuthenticationStoreModule {}
