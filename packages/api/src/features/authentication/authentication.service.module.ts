import { Module } from '@nestjs/common';
import { AuthenticationStoreModule } from './authentication.store.module';
import { AuthenticationService } from './service/authentication.service';
import { SSOAuthenticationService } from './service/ssoauthentication.service';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationGuard } from './guards/authentication.guard';
import { UserManagementService } from './service/user-management.service';

@Module({
  imports: [AuthenticationStoreModule, SharedModule],
  providers: [
    AuthenticationService,
    SSOAuthenticationService,
    AuthenticationGuard,
    UserManagementService,
  ],
  exports: [
    AuthenticationService,
    SSOAuthenticationService,
    UserManagementService,
    AuthenticationGuard,
  ],
})
export class AuthenticationServiceModule {}
