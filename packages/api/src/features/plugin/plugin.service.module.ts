import { Module } from '@nestjs/common';
import { PluginRegistryService } from './service/plugin-registry.service';
import { PluginService } from './service/plugin.service';

@Module({
  providers: [PluginRegistryService, PluginService],
  exports: [PluginRegistryService, PluginService],
})
export class PluginServiceModule {}
