import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { PluginController } from './controller/plugin.controller';
import { PluginServiceModule } from './plugin.service.module';

@Module({
  imports: [PluginServiceModule, AuthenticationServiceModule],
  controllers: [PluginController],
})
export class PluginModule {}
