import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MetadataWebhookDeliveryStore } from './store/metadata-webhook-delivery.store';
import { MetadataWebhookWorkflowStore } from './store/metadata-webhook-workflow.store';

@Module({
  imports: [DatabaseModule],
  providers: [MetadataWebhookDeliveryStore, MetadataWebhookWorkflowStore],
  exports: [MetadataWebhookDeliveryStore, MetadataWebhookWorkflowStore],
})
export class WorkflowStoreModule {}
