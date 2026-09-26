import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { SettingsController } from './controller/settings.controller';

@Module({
  imports: [AuthenticationServiceModule, SharedModule],
  controllers: [SettingsController]
})
export class SettingsModule {}

