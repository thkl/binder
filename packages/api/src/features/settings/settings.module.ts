import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { SettingsController } from './controller/settings.controller';
import { ApplicationSettingsService } from './service/application-settings.service';

@Module({
  imports: [AuthenticationServiceModule, SharedModule],
  controllers: [SettingsController],
  providers: [ApplicationSettingsService],
  exports: [ApplicationSettingsService],
})
export class SettingsModule {}
