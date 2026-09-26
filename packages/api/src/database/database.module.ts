import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { BinderConfig, ConfigKeys } from '../shared/config/config.keys';
import { DatabaseConnectionService } from './service/database-connection.service';
import { DatabaseMigrationService } from './service/database-migration.service';
import { User } from '../features/authentication/models/user.entity';
import { ApplicationSetting } from '../features/settings/models/settings.model';
import { Document } from '../features/document/models/document.entity';
import { PipelineJob } from '../features/pipeline/models/pipeline-job.entity';
import { PipelineJobEvent } from '../features/pipeline/models/pipeline-job-event.entity';

@Global()
@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<BinderConfig>) => {
        const databaseHost = config.get<string>(ConfigKeys.DATABASE_HOST);
        const databaseName = config.get<string>(ConfigKeys.DATABASE_NAME);
        const databasePort = config.get<number>(ConfigKeys.DATABASE_PORT);
        const databaseUser = config.get<string>(ConfigKeys.DATABASE_USER);
        const databasePassword = config.get<string>(ConfigKeys.DATABASE_PASSWORD);

        if (!databaseHost) {
          throw new Error(`Missing required configuration key: ${ConfigKeys.DATABASE_HOST}`);
        }

        return {
          dialect: 'postgres' as const,
          host: databaseHost,
          port: databasePort || 5432,
          database: databaseName,
          username: databaseUser,
          password: databasePassword,
          autoLoadModels: false,
          synchronize: false,
          logging: config.get<string>(ConfigKeys.DATABASE_LOGGING) === 'true',
          retry: {
            max: 5,
            match: [
              /ETIMEDOUT/,
              /EHOSTUNREACH/,
              /ECONNRESET/,
              /ECONNREFUSED/,
              /ConnectionError/,
              /SequelizeConnectionError/
            ]
          },
          pool: {
            max: 10,
            min: 0,
            idle: 10_000,
            acquire: 30_000
          }
        };
      }
    }),
    SequelizeModule.forFeature([User, ApplicationSetting, Document, PipelineJob, PipelineJobEvent]),
  ],
  providers: [DatabaseConnectionService,DatabaseMigrationService],
  exports: [DatabaseConnectionService]
})
export class DatabaseModule { }
