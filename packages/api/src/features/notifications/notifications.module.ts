import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsStoreModule } from './notifications.store.module';
import { DocumentStoreModule } from '../document/document.store.module';

@Module({
  imports: [
    AuthenticationServiceModule,
    SharedModule,
    NotificationsStoreModule,
    DocumentStoreModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
