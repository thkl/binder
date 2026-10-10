import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PushDeviceStore } from './store/push-device.store';
import { PushNotificationEventStore } from './store/push-notification-event.store';

@Module({
  imports: [DatabaseModule],
  providers: [PushDeviceStore, PushNotificationEventStore],
  exports: [PushDeviceStore, PushNotificationEventStore],
})
export class NotificationsStoreModule {}
