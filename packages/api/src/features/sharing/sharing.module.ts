import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharingController } from './controller/sharing.controller';
import { SharingServiceModule } from './sharing.service.module';

@Module({
  imports: [AuthenticationServiceModule, SharingServiceModule],
  controllers: [SharingController],
})
export class SharingModule {}
