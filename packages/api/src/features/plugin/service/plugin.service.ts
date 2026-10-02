import { Injectable } from '@nestjs/common';
import { PluginListResponse, PluginListResponseSchema } from '@binder/common';
import { PluginRegistryService } from './plugin-registry.service';

@Injectable()
export class PluginService {
  constructor(private readonly registry: PluginRegistryService) {}

  list(): PluginListResponse {
    return PluginListResponseSchema.parse({
      items: this.registry.list(),
    });
  }
}
