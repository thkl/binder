import { Module } from '@nestjs/common';
import { AuthenticationStoreModule } from './authentication.store.module';
import { AuthenticationService } from './service/authentication.service';
import { SSOAuthenticationService } from './service/ssoauthentication.service';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationGuard } from './guards/authentication.guard';
import { UserManagementService } from './service/user-management.service';
import { PermissionGuard } from '../../shared/guards/permission.guard';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './models/user.entity';

@Module({
  imports: [AuthenticationStoreModule, SharedModule, SequelizeModule.forFeature([User])],
  providers: [
    AuthenticationService,
    SSOAuthenticationService,
    AuthenticationGuard,
    UserManagementService,
    PermissionGuard,
  ],
  exports: [
    AuthenticationService,
    SSOAuthenticationService,
    UserManagementService,
    AuthenticationGuard,
    PermissionGuard,
  ],
})
export class AuthenticationServiceModule {}
