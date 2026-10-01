import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'node:path';
import { HealthController } from './health.controller';
import { SharedModule } from './shared/shared.service.module';
import { DatabaseModule } from './database/database.module';
import { BinderConfig, ConfigKeys } from './shared/config/config.keys';
import { AuthenticationModule } from './features/authentication/authentication.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SettingsModule } from './features/settings/settings.module';
import { DocumentModule } from './features/document/document.module';
import { PipelineModule } from './features/pipeline/pipeline.module';
import { MetadataModule } from './features/metadata/metadata.module';
import { InboxModule } from './features/inbox/inbox.module';
import { IssuerModule } from './features/issuer/issuer.module';
import { LogsModule } from './features/logs/logs.module';
import { MaintenanceModule } from './features/maintenance/maintenance.module';
import { FolderModule } from './features/folder/folder.module';
import { SavedSearchModule } from './features/saved-search/saved-search.module';
import { SetupModule } from './features/setup/setup.module';
import { AiProviderModule } from './features/ai-provider/ai-provider.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    SharedModule,
    AuthenticationModule,
    SettingsModule,
    DocumentModule,
    PipelineModule,
    MetadataModule,
    InboxModule,
    IssuerModule,
    LogsModule,
    MaintenanceModule,
    FolderModule,
    SavedSearchModule,
    SetupModule,
    AiProviderModule,
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<BinderConfig>) => {
        const appRootPath = config.get<string>(ConfigKeys.APP_ROOT_PATH) ?? process.cwd();
        const apiPrefix = config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';

        const escapedApiPrefix = apiPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return [
          {
            rootPath: resolve(appRootPath, 'client'),
            exclude: new RegExp(`^/${escapedApiPrefix}(?:/.*)?$`),
          },
        ];
      },
    }),
  ],
})
export class AppModule {}
