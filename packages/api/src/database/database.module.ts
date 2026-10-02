import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { BinderConfig, ConfigKeys } from '../shared/config/config.keys';
import { DatabaseConnectionService } from './service/database-connection.service';
import { DatabaseMigrationService } from './service/database-migration.service';
import { User } from '../features/authentication/models/user.entity';
import { ApplicationSetting } from '../features/settings/models/settings.model';
import { Document } from '../features/document/models/document.entity';
import { DocumentPage } from '../features/document/models/document-page.entity';
import { DocumentEmbedding } from '../features/document/models/document-embedding.entity';
import { PipelineJob } from '../features/pipeline/models/pipeline-job.entity';
import { PipelineJobEvent } from '../features/pipeline/models/pipeline-job-event.entity';
import {
  DocumentCategory,
  DocumentTag,
  DocumentTagAssignment,
  DocumentType,
} from '../features/metadata/models/vocabulary.entity';
import {
  DocumentMetadataValue,
  MetadataDefinition,
} from '../features/metadata/models/vocabulary.entity';
import { InboxItem } from '../features/inbox/models/inbox-item.entity';
import { Issuer } from '../features/issuer/models/issuer.entity';
import { MaintenanceRun } from '../features/maintenance/models/maintenance-run.entity';
import { MaintenanceRequest } from '../features/maintenance/models/maintenance-request.entity';
import { Folder } from '../features/folder/models/folder.entity';
import { DocumentFolder } from '../features/folder/models/document-folder.entity';
import { SavedSearch } from '../features/saved-search/models/saved-search.entity';
import { DocumentStorageIssue } from '../features/document/models/document-storage-issue.entity';
import { SetupState } from '../features/setup/models/setup-state.entity';
import { AiProviderProfile } from '../features/ai-provider/models/ai-provider.entity';
import { DocumentAnalysisSession } from '../features/document/models/document-analysis-session.entity';
import { DocumentAuditEventEntity } from '../features/document/models/document-audit-event.entity';
import { DocumentMetadataChangeSet } from '../features/document/models/document-metadata-change-set.entity';
import { PipelineWorkerHeartbeat } from '../features/pipeline/models/pipeline-worker-heartbeat.entity';
import { CalendarEvent } from '../features/calendar/models/calendar-event.entity';

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
              /SequelizeConnectionError/,
            ],
          },
          pool: {
            max: 10,
            min: 0,
            idle: 10_000,
            acquire: 30_000,
          },
        };
      },
    }),
    SequelizeModule.forFeature([
      User,
      ApplicationSetting,
      Document,
      DocumentPage,
      DocumentEmbedding,
      PipelineJob,
      PipelineJobEvent,
      DocumentType,
      DocumentCategory,
      DocumentTag,
      DocumentTagAssignment,
      MetadataDefinition,
      DocumentMetadataValue,
      InboxItem,
      Issuer,
      MaintenanceRun,
      MaintenanceRequest,
      Folder,
      DocumentFolder,
      SavedSearch,
      DocumentStorageIssue,
      SetupState,
      AiProviderProfile,
      DocumentAnalysisSession,
      DocumentAuditEventEntity,
      DocumentMetadataChangeSet,
      PipelineWorkerHeartbeat,
      CalendarEvent,
    ]),
  ],
  providers: [DatabaseConnectionService, DatabaseMigrationService],
  exports: [DatabaseConnectionService],
})
export class DatabaseModule {}
