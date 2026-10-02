import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentAuditStoreModule } from './document-audit.store.module';
import { DocumentAuditService } from './service/document-audit.service';
import { PluginServiceModule } from '../plugin/plugin.service.module';

@Module({
  imports: [DocumentAuditStoreModule, DocumentStoreModule, PluginServiceModule],
  providers: [DocumentAuditService],
  exports: [DocumentAuditService],
})
export class DocumentAuditServiceModule {}
