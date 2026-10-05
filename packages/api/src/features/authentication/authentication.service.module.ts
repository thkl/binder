import { Module } from '@nestjs/common';
import { AuthenticationStoreModule } from './authentication.store.module';
import { AuthenticationService } from './service/authentication.service';
import { SSOAuthenticationService } from './service/ssoauthentication.service';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationGuard } from './guards/authentication.guard';
import { UserManagementService } from './service/user-management.service';
import { ApiTokenService } from './service/api-token.service';
import { ApiTokenGuard } from './guards/api-token.guard';
import { PermissionGuard } from '../../shared/guards/permission.guard';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './models/user.entity';
import { ApiToken } from './models/api-token.entity';

@Module({
  imports: [AuthenticationStoreModule, SharedModule, SequelizeModule.forFeature([User, ApiToken])],
  providers: [
    AuthenticationService,
    SSOAuthenticationService,
    AuthenticationGuard,
    UserManagementService,
    ApiTokenService,
    ApiTokenGuard,
    PermissionGuard,
  ],
  exports: [
    AuthenticationService,
    SSOAuthenticationService,
    UserManagementService,
    AuthenticationGuard,
    ApiTokenService,
    ApiTokenGuard,
    PermissionGuard,
  ],
})
export class AuthenticationServiceModule {}
