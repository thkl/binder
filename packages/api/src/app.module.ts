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
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<BinderConfig>) => {
        const clientPath = config.get<string>(ConfigKeys.CLIENT_PATH);
        const apiPrefix = config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';

        if (!clientPath) {
          throw new Error(`Missing required configuration key: ${ConfigKeys.CLIENT_PATH}`);
        }

        const escapedApiPrefix = apiPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return [{
          rootPath: resolve(process.cwd(), clientPath),
          exclude: new RegExp(`^/${escapedApiPrefix}(?:/.*)?$`)
        }];
      }
    })
  ]
})
export class AppModule { }
