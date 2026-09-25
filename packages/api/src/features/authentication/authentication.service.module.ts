import { Module } from '@nestjs/common';
import { AuthenticationStoreModule } from './authentication.store.module';
import { AuthenticationService } from './authentication.service';

@Module({
  imports: [AuthenticationStoreModule],
  providers: [AuthenticationService],
  exports: [AuthenticationService]
})
export class AuthenticationServiceModule {}
