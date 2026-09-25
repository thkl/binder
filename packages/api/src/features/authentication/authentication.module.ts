import { Module } from '@nestjs/common';
import { AuthenticationController } from './controller/authentication.controller';
import { AuthenticationController as SSOAuthenticationController } from './controller/ssoauthentication.controller';
import { AuthenticationServiceModule } from './authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';

@Module({
  imports: [AuthenticationServiceModule,SharedModule],
  controllers: [AuthenticationController, SSOAuthenticationController]
})
export class AuthenticationModule {}
