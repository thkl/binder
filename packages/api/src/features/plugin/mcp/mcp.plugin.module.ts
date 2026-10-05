import { DynamicModule, Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthenticationServiceModule } from '../../authentication/authentication.service.module';
import { User } from '../../authentication/models/user.entity';
import { DocumentServiceModule } from '../../document/document.service.module';
import { PluginServiceModule } from '../plugin.service.module';
import { PluginRegistryService } from '../service/plugin-registry.service';
import { SettingsModule } from '../../settings/settings.module';
import { ApiTokenController } from './controller/api-token.controller';
import { McpController } from './controller/mcp.controller';
import { ApiToken } from './models/api-token.entity';
import { ApiTokenGuard } from './guards/api-token.guard';
import { ApiTokenService } from './service/api-token.service';
import { McpRuntimeService } from './service/mcp-runtime.service';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';

export const MCP_PLUGIN_ENABLED = Symbol('MCP_PLUGIN_ENABLED');

@Injectable()
class McpPluginRegistration implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    @Inject(MCP_PLUGIN_ENABLED) private readonly enabled: boolean,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      manifest: {
        id: 'mcp',
        name: 'Model Context Protocol',
        version: '0.1.0',
        description: 'Provides MCP document tools and user-scoped API tokens.',
        capabilities: ['mcp'],
        enabled: this.enabled,
      },
    });
  }
}

@Module({})
export class McpPluginModule {
  static register(enabled: boolean): DynamicModule {
    return {
      module: McpPluginModule,
      imports: [
        PluginServiceModule,
        SettingsModule,
        ...(enabled
          ? [
              AuthenticationServiceModule,
              DocumentServiceModule,
              SequelizeModule.forFeature([ApiToken, User]),
            ]
          : []),
      ],
      controllers: enabled ? [McpController, ApiTokenController] : [],
      providers: [
        { provide: MCP_PLUGIN_ENABLED, useValue: enabled },
        McpPluginRegistration,
        McpRuntimeService,
        McpEnabledGuard,
        ...(enabled ? [ApiTokenService, ApiTokenGuard] : []),
      ],
    };
  }
}
