import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentStore } from './store/document.store';
import { DocumentStorageIssueStore } from './store/document-storage-issue.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentStore, DocumentStorageIssueStore],
  exports: [DocumentStore, DocumentStorageIssueStore],
})
export class DocumentStoreModule {}
