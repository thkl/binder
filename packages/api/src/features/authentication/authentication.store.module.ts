import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserStore } from './stores/user.store';

@Module({
  imports: [DatabaseModule],
  providers: [UserStore],
  exports: [UserStore],
})
export class AuthenticationStoreModule {}
