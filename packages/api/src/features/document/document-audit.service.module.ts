import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentAuditStoreModule } from './document-audit.store.module';
import { DocumentAuditService } from './service/document-audit.service';

@Module({
  imports: [DocumentAuditStoreModule, DocumentStoreModule],
  providers: [DocumentAuditService],
  exports: [DocumentAuditService],
})
export class DocumentAuditServiceModule {}
