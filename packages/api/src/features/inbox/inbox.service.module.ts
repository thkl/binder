import { Module } from '@nestjs/common';
import { DocumentServiceModule } from '../document/document.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { InboxStoreModule } from './inbox.store.module';
import { InboxService } from './service/inbox.service';
import { AutomaticInboxAnalysisService } from './service/automatic-inbox-analysis.service';
import { DocumentAuditServiceModule } from '../document/document-audit.service.module';

@Module({
  imports: [InboxStoreModule, DocumentServiceModule, DocumentAuditServiceModule, SharedModule],
  providers: [InboxService, AutomaticInboxAnalysisService],
  exports: [InboxService],
})
export class InboxServiceModule {}
