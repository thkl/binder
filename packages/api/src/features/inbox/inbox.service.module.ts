import { Module } from '@nestjs/common';
import { DocumentServiceModule } from '../document/document.service.module';
import { InboxStoreModule } from './inbox.store.module';
import { InboxService } from './service/inbox.service';

@Module({
  imports: [InboxStoreModule, DocumentServiceModule],
  providers: [InboxService],
  exports: [InboxService]
})
export class InboxServiceModule {}
