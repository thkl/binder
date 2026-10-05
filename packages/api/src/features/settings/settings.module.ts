import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { SettingsController } from './controller/settings.controller';
import { ApplicationSettingsService } from './service/application-settings.service';
import { ApplicationSettingStore } from './store/application-setting.store';

@Module({
  imports: [AuthenticationServiceModule, SharedModule],
  controllers: [SettingsController],
  providers: [ApplicationSettingsService, ApplicationSettingStore],
  exports: [ApplicationSettingsService],
})
export class SettingsModule {}
