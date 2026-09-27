import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { IssuerController } from './controller/issuer.controller';
import { IssuerServiceModule } from './issuer.service.module';

@Module({
  imports: [IssuerServiceModule, AuthenticationServiceModule],
  controllers: [IssuerController]
})
export class IssuerModule {}
