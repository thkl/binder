import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MetadataWebhookDeliveryStore } from './store/metadata-webhook-delivery.store';

@Module({
  imports: [DatabaseModule],
  providers: [MetadataWebhookDeliveryStore],
  exports: [MetadataWebhookDeliveryStore],
})
export class WorkflowStoreModule {}
