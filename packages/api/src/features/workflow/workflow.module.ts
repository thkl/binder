import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { DocumentStoreModule } from '../document/document.store.module';
import { MetadataServiceModule } from '../metadata/metadata.service.module';
import { PluginServiceModule } from '../plugin/plugin.service.module';
import { MetadataWebhookController } from './controller/metadata-webhook.controller';
import { MetadataWebhookService } from './service/metadata-webhook.service';
import { WorkflowStoreModule } from './workflow.store.module';

@Module({
  imports: [
    AuthenticationServiceModule,
    SharedModule,
    DocumentStoreModule,
    MetadataServiceModule,
    PluginServiceModule,
    WorkflowStoreModule,
  ],
  controllers: [MetadataWebhookController],
  providers: [MetadataWebhookService],
})
export class WorkflowModule {}
