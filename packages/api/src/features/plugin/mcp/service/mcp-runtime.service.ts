import { Injectable } from '@nestjs/common';
import { ApplicationSettingsService } from '../../../settings/service/application-settings.service';

@Injectable()
export class McpRuntimeService {
  constructor(private readonly settings: ApplicationSettingsService) {}

  async isEnabled(): Promise<boolean> {
    const value = await this.settings.get('security.mcp.enabled', 'true');
    return value !== 'false';
  }
}
