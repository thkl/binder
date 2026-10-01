import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentAuditEventStore } from './store/document-audit-event.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentAuditEventStore],
  exports: [DocumentAuditEventStore],
})
export class DocumentAuditStoreModule {}
